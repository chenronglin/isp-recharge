# 深圳科飞真实供应商接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“深圳科飞”作为正式供应商接入现有后台系统，支持通过我方后台/内部接口完成真实余额查询与产品同步，并通过现有开放下单主链路完成真实话费充值。

**Architecture:** 保持现有单体模块化结构不变，把上游协议差异全部收敛在 `suppliers/adapters` 层，再由 `SuppliersService` 统一编排商品同步、提单、查单和回调推进。后台接口只补“余额查询”和“手工同步目录”能力，真实充值继续走 `POST /open-api/orders`，主供应商切换通过 `product_supplier_mappings` 的 `priority/status` 控制，而不是通过硬编码全量替换。

**Tech Stack:** Bun、TypeScript、Elysia、PostgreSQL、Node `crypto`、GBK 编码库 `iconv-lite`

---

## 文件结构

### 产出文件

- Create: `backend/src/modules/suppliers/adapters/shenzhen-kefei.adapter.ts`
- Create: `backend/src/modules/suppliers/adapters/shenzhen-kefei.protocol.ts`
- Create: `backend/tests/shenzhen-kefei-adapter.test.ts`
- Create: `backend/tests/suppliers-admin-kefei.test.ts`
- Create: `backend/tests/suppliers-callback-kefei.test.ts`
- Create: `docs/shenzhen-kefei-manual-test.md`

### 需修改文件

- Modify: `backend/package.json`
- Modify: `backend/src/modules/suppliers/adapters/types.ts`
- Modify: `backend/src/modules/suppliers/suppliers.service.ts`
- Modify: `backend/src/modules/suppliers/suppliers.routes.ts`
- Modify: `backend/src/modules/suppliers/suppliers.repository.ts`
- Modify: `backend/src/modules/suppliers/contracts.ts`
- Modify: `backend/tests/order-flow-v1.test.ts`

### 关键约束

- 不把供应商账号、密钥硬编码进代码或种子数据，仍通过后台配置接口录入。
- 不新增真实充值测试专用开放接口，真实下单继续复用 `POST /open-api/orders`。
- 不在本期接入流量、权益、游戏、预下单能力。
- 回调必须兼容现有 `mock-supplier` 的 JSON + HMAC，也要支持深圳科飞的 `form-urlencoded + MD5`。
- 手工验收以白名单服务器为准；本机环境不作为真实联调出口。

### Task 1: 扩展供应商协议抽象与深圳科飞协议工具

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/modules/suppliers/adapters/types.ts`
- Create: `backend/src/modules/suppliers/adapters/shenzhen-kefei.protocol.ts`
- Test: `backend/tests/shenzhen-kefei-adapter.test.ts`

- [ ] **Step 1: 写失败测试，先锁定协议工具的行为**

在 `backend/tests/shenzhen-kefei-adapter.test.ts` 写入以下测试骨架：

```ts
import { describe, expect, test } from 'bun:test';
import {
  buildKefeiSign,
  buildKefeiPayload,
  decodeKefeiResponse,
  mapKefeiOrderStatus,
  parseKefeiCallbackForm,
  verifyKefeiCallbackSign,
} from '@/modules/suppliers/adapters/shenzhen-kefei.protocol';

describe('深圳科飞协议工具', () => {
  test('构造余额查询 payload 时保留稳定字段顺序并生成 sign', () => {
    const payload = buildKefeiPayload({
      agentAccount: 'JG18948358181',
      md5Key: 'F29C80BB80EA32D4',
      busiBody: { action: 'YE' },
      fieldOrder: ['action'],
    });

    expect(payload.agentAccount).toBe('JG18948358181');
    expect(payload.busiBodyText).toBe('{"action":"YE"}');
    expect(payload.sign).toBe(buildKefeiSign('{"action":"YE"}', 'F29C80BB80EA32D4'));
  });

  test('订单状态码映射到平台标准状态', () => {
    expect(mapKefeiOrderStatus('0')).toEqual({ status: 'QUERYING' });
    expect(mapKefeiOrderStatus('16')).toEqual({ status: 'SUCCESS' });
    expect(mapKefeiOrderStatus('35')).toEqual({ status: 'FAIL' });
  });

  test('回调表单解析和验签符合文档规则', () => {
    const form =
      'Action=CX&AgentAccount=JG18948358181&Orderid=T1001&Chargeid=2893131209&Orderstatu_int=16&Orderstatu_text=%BD%C9%B7%D1%B3%C9%B9%A6&OrderPayment=10.00&Errorcode=0000&Errormsg=&Sign=b47756e7aedc27f265aede465d75db0f';

    const parsed = parseKefeiCallbackForm(form);

    expect(parsed.Orderid).toBe('T1001');
    expect(parsed.Orderstatu_int).toBe('16');
    expect(
      verifyKefeiCallbackSign(parsed, '13D5C4F4910EDC34', parsed.Sign),
    ).toBeTrue();
  });

  test('GBK 响应可被正常解码', () => {
    const encoded = Buffer.from('{"errorCode":1,"errorDesc":"操作成功"}', 'utf8');
    expect(decodeKefeiResponse(encoded)).toContain('"errorCode":1');
  });
});
```

- [ ] **Step 2: 运行单测，确认当前缺少协议实现**

工作目录：`/Users/moses/Trae-CN/isp-recharge/backend`

Run:

```bash
bun test tests/shenzhen-kefei-adapter.test.ts
```

Expected: FAIL，报错应包含 `Cannot find module '@/modules/suppliers/adapters/shenzhen-kefei.protocol'` 或未定义导出。

- [ ] **Step 3: 加依赖并实现协议工具最小版本**

先修改 `backend/package.json` 依赖区，加入：

```json
"iconv-lite": "^0.6.3"
```

然后创建 `backend/src/modules/suppliers/adapters/shenzhen-kefei.protocol.ts`：

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import iconv from 'iconv-lite';

export function buildKefeiSign(busiBodyText: string, md5Key: string): string {
  return createHash('md5').update(`${busiBodyText}${md5Key}`, 'utf8').digest('hex');
}

export function buildKefeiPayload(input: {
  agentAccount: string;
  md5Key: string;
  busiBody: Record<string, unknown>;
  fieldOrder: string[];
}) {
  const orderedEntries = input.fieldOrder.map((key) => [key, input.busiBody[key]]);
  const busiBodyObject = Object.fromEntries(orderedEntries);
  const busiBodyText = JSON.stringify(busiBodyObject);

  return {
    sign: buildKefeiSign(busiBodyText, input.md5Key),
    agentAccount: input.agentAccount,
    busiBody: busiBodyObject,
    busiBodyText,
    bodyBuffer: iconv.encode(
      JSON.stringify({
        sign: buildKefeiSign(busiBodyText, input.md5Key),
        agentAccount: input.agentAccount,
        busiBody: busiBodyObject,
      }),
      'gbk',
    ),
  };
}

export function decodeKefeiResponse(input: ArrayBuffer | Buffer): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return iconv.decode(buffer, 'gbk');
}

export function mapKefeiOrderStatus(code: string): { status: 'QUERYING' | 'SUCCESS' | 'FAIL' } {
  if (['11', '16'].includes(code)) {
    return { status: 'SUCCESS' };
  }

  if (['20', '21', '26', '35'].includes(code)) {
    return { status: 'FAIL' };
  }

  return { status: 'QUERYING' };
}

export function parseKefeiCallbackForm(formText: string): Record<string, string> {
  const params = new URLSearchParams(formText);
  return Object.fromEntries(params.entries());
}

export function verifyKefeiCallbackSign(
  form: Record<string, string>,
  md5Key: string,
  providedSign: string,
): boolean {
  const raw = `Orderid=${form.Orderid}&Chargeid=${form.Chargeid}&Orderstatu_int=${form.Orderstatu_int}&Errorcode=0000&Password=${md5Key}`;
  const expected = createHash('md5').update(raw, 'utf8').digest('hex');
  const left = Buffer.from(expected.toLowerCase());
  const right = Buffer.from(String(providedSign).toLowerCase());

  return left.length === right.length && timingSafeEqual(left, right);
}
```

同时把 `backend/src/modules/suppliers/adapters/types.ts` 扩成：

```ts
export interface SupplierBalanceResult {
  agentAccount: string;
  agentName?: string;
  agentBalance: number;
  agentProfit?: number;
  errorCode: number;
  errorDesc?: string;
}

export interface SupplierCatalogSyncResult {
  items: Array<{
    productCode: string;
    productName: string;
    carrierCode: string;
    provinceName: string;
    faceValue: number;
    rechargeMode: string;
    purchasePrice: number;
    inventoryQuantity: number;
    supplierProductCode: string;
    salesStatus?: string;
  }>;
}

export interface SupplierAdapter {
  readonly code: string;
  getBalance?(): Promise<SupplierBalanceResult>;
  syncCatalog?(): Promise<SupplierCatalogSyncResult>;
  submitOrder(input: {
    orderNo: string;
    productId: string;
    supplierProductCode: string;
    mobile?: string;
    faceValue?: number;
    ispName?: string;
    province?: string;
    callbackUrl?: string;
  }): Promise<{
    supplierOrderNo: string;
    status: 'ACCEPTED' | 'PROCESSING';
    rawCode?: number;
    rawMessage?: string;
  }>;
  queryOrder(input: {
    supplierOrderNo: string;
    attemptIndex: number;
    orderNo?: string;
  }): Promise<{
    status: 'QUERYING' | 'SUCCESS' | 'FAIL';
    reason?: string;
    rawStatusCode?: string;
  }>;
  parseCallback(input: {
    headers: Record<string, unknown>;
    body: Record<string, unknown>;
    rawBody?: string;
    contentType?: string;
  }): Promise<{
    supplierOrderNo: string;
    status: 'SUCCESS' | 'FAIL';
    reason?: string;
  }>;
}
```

- [ ] **Step 4: 运行单测，确认协议工具通过**

工作目录：`/Users/moses/Trae-CN/isp-recharge/backend`

Run:

```bash
bun install
bun test tests/shenzhen-kefei-adapter.test.ts
```

Expected: PASS，至少 4 个测试通过。

- [ ] **Step 5: 提交协议层基础**

```bash
git add backend/package.json backend/src/modules/suppliers/adapters/types.ts backend/src/modules/suppliers/adapters/shenzhen-kefei.protocol.ts backend/tests/shenzhen-kefei-adapter.test.ts
git commit -m "feat: add shenzhen kefei protocol primitives"
```

### Task 2: 实现深圳科飞适配器并接入 SuppliersService

**Files:**
- Create: `backend/src/modules/suppliers/adapters/shenzhen-kefei.adapter.ts`
- Modify: `backend/src/modules/suppliers/contracts.ts`
- Modify: `backend/src/modules/suppliers/suppliers.service.ts`
- Test: `backend/tests/shenzhen-kefei-adapter.test.ts`

- [ ] **Step 1: 先写失败测试，锁定适配器的核心行为**

在 `backend/tests/shenzhen-kefei-adapter.test.ts` 追加以下测试：

```ts
import { describe, expect, mock, test } from 'bun:test';
import { ShenzhenKefeiAdapter } from '@/modules/suppliers/adapters/shenzhen-kefei.adapter';

describe('深圳科飞适配器', () => {
  test('余额查询返回标准结果', async () => {
    const adapter = new ShenzhenKefeiAdapter({
      baseUrl: 'http://api.sohan.hk:50080/API',
      agentAccount: 'JG18948358181',
      md5Key: 'F29C80BB80EA32D4',
      callbackUrl: 'https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei',
      fetchImpl: mock(async () =>
        new Response('{"action":"YE","agentAccount":"JG18948358181","agentBalance":100.5,"agentProfit":0,"agentName":"金骏通信话费充值","errorCode":1,"errorDesc":"操作完成"}'),
      ),
    });

    const result = await adapter.getBalance();

    expect(result.errorCode).toBe(1);
    expect(result.agentBalance).toBe(100.5);
    expect(result.agentName).toBe('金骏通信话费充值');
  });

  test('产品列表查询映射为平台目录项', async () => {
    const adapter = new ShenzhenKefeiAdapter({
      baseUrl: 'http://api.sohan.hk:50080/API',
      agentAccount: 'JG18948358181',
      md5Key: 'F29C80BB80EA32D4',
      callbackUrl: 'https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei',
      fetchImpl: mock(async () =>
        new Response('{"action":"CHECK_SPU","agentAccount":"JG18948358181","errorCode":1,"errorDesc":"操作成功","dataset":[{"productSn":7001001,"province":"广东","ispName":"移动","spuName":"广东移动100元","discount":99.5,"amount":100}]}'),
      ),
    });

    const result = await adapter.syncCatalog();

    expect(result.items[0]).toMatchObject({
      supplierProductCode: '7001001',
      carrierCode: 'CMCC',
      provinceName: '广东',
      faceValue: 100,
    });
  });

  test('话费充值成功时返回 ACCEPTED 和 chargeId', async () => {
    const adapter = new ShenzhenKefeiAdapter({
      baseUrl: 'http://api.sohan.hk:50080/API',
      agentAccount: 'JG18948358181',
      md5Key: 'F29C80BB80EA32D4',
      callbackUrl: 'https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei',
      fetchImpl: mock(async () =>
        new Response('{"action":"CZ","agentAccount":"JG18948358181","orderId":"ORD-1","chargeId":"18100001","errorCode":1,"errorDesc":"操作成功"}'),
      ),
    });

    const result = await adapter.submitOrder({
      orderNo: 'ORD-1',
      productId: 'p1',
      supplierProductCode: '7001001',
      mobile: '13800138000',
      faceValue: 100,
      ispName: '移动',
      province: '广东',
      callbackUrl: 'https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei',
    });

    expect(result.status).toBe('ACCEPTED');
    expect(result.supplierOrderNo).toBe('18100001');
  });
});
```

- [ ] **Step 2: 运行单测，确认适配器尚未实现**

Run:

```bash
bun test tests/shenzhen-kefei-adapter.test.ts
```

Expected: FAIL，错误应包含 `Cannot find module '@/modules/suppliers/adapters/shenzhen-kefei.adapter'`。

- [ ] **Step 3: 实现真实适配器与服务接入**

创建 `backend/src/modules/suppliers/adapters/shenzhen-kefei.adapter.ts`：

```ts
import type {
  SupplierAdapter,
  SupplierBalanceResult,
  SupplierCatalogSyncResult,
} from '@/modules/suppliers/adapters/types';
import {
  buildKefeiPayload,
  decodeKefeiResponse,
  mapKefeiOrderStatus,
  parseKefeiCallbackForm,
} from '@/modules/suppliers/adapters/shenzhen-kefei.protocol';

interface ShenzhenKefeiAdapterOptions {
  baseUrl: string;
  agentAccount: string;
  md5Key: string;
  callbackUrl: string;
  fetchImpl?: typeof fetch;
}

export class ShenzhenKefeiAdapter implements SupplierAdapter {
  readonly code = 'shenzhen-kefei';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ShenzhenKefeiAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(fieldOrder: string[], busiBody: Record<string, unknown>): Promise<T> {
    const payload = buildKefeiPayload({
      agentAccount: this.options.agentAccount,
      md5Key: this.options.md5Key,
      busiBody,
      fieldOrder,
    });

    const response = await this.fetchImpl(this.options.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=GBK',
      },
      body: payload.bodyBuffer,
    });
    const text = decodeKefeiResponse(await response.arrayBuffer());

    return JSON.parse(text) as T;
  }

  async getBalance(): Promise<SupplierBalanceResult> {
    const result = await this.request<any>(['action'], {
      action: 'YE',
    });

    return {
      agentAccount: result.agentAccount,
      agentName: result.agentName,
      agentBalance: Number(result.agentBalance ?? 0),
      agentProfit: Number(result.agentProfit ?? 0),
      errorCode: Number(result.errorCode ?? -999),
      errorDesc: result.errorDesc,
    };
  }

  async syncCatalog(): Promise<SupplierCatalogSyncResult> {
    const result = await this.request<any>(['action'], {
      action: 'CHECK_SPU',
    });

    return {
      items: (result.dataset ?? []).map((item: any) => ({
        productCode: `kefei-hf-${item.productSn}`,
        productName: item.spuName,
        carrierCode:
          item.ispName === '移动'
            ? 'CMCC'
            : item.ispName === '联通'
              ? 'CUCC'
              : item.ispName === '电信'
                ? 'CTCC'
                : 'CBN',
        provinceName: item.province,
        faceValue: Number(item.amount),
        rechargeMode: 'MIXED',
        purchasePrice: Number(item.amount) * Number(item.discount) / 100,
        inventoryQuantity: 999999,
        supplierProductCode: String(item.productSn),
        salesStatus: 'ON_SALE',
      })),
    };
  }

  async submitOrder(input: {
    orderNo: string;
    productId: string;
    supplierProductCode: string;
    mobile?: string;
    faceValue?: number;
    ispName?: string;
    province?: string;
    callbackUrl?: string;
  }) {
    const result = await this.request<any>(
      ['action', 'orderId', 'chargeAcct', 'chargeCash', 'chargeType', 'ispName', 'province', 'retUrl'],
      {
        action: 'CZ',
        orderId: input.orderNo,
        chargeAcct: input.mobile ?? '',
        chargeCash: String(input.faceValue ?? ''),
        chargeType: '0',
        ispName: encodeURIComponent(input.ispName ?? ''),
        province: input.province ?? '',
        retUrl: encodeURIComponent(input.callbackUrl ?? this.options.callbackUrl),
      },
    );

    if (Number(result.errorCode) === -310) {
      return {
        supplierOrderNo: String(result.chargeId ?? input.orderNo),
        status: 'PROCESSING' as const,
        rawCode: Number(result.errorCode),
        rawMessage: result.errorDesc,
      };
    }

    if (Number(result.errorCode) !== 1) {
      throw new Error(result.errorDesc || `深圳科飞下单失败: ${result.errorCode}`);
    }

    return {
      supplierOrderNo: String(result.chargeId),
      status: 'ACCEPTED' as const,
      rawCode: Number(result.errorCode),
      rawMessage: result.errorDesc,
    };
  }

  async queryOrder(input: { supplierOrderNo: string; attemptIndex: number; orderNo?: string }) {
    const result = await this.request<any>(['action', 'orderId'], {
      action: 'CX',
      orderId: input.orderNo ?? input.supplierOrderNo,
    });
    const mapped = mapKefeiOrderStatus(String(result.orderStatuInt ?? '0'));

    return {
      status: mapped.status,
      reason: result.errorDesc || result.orderStatuText,
      rawStatusCode: String(result.orderStatuInt ?? ''),
    };
  }

  async parseCallback(input: {
    headers: Record<string, unknown>;
    body: Record<string, unknown>;
    rawBody?: string;
    contentType?: string;
  }) {
    const form = parseKefeiCallbackForm(input.rawBody ?? '');
    const mapped = mapKefeiOrderStatus(String(form.Orderstatu_int ?? '0'));

    return {
      supplierOrderNo: String(form.Chargeid ?? ''),
      status: mapped.status === 'SUCCESS' ? 'SUCCESS' : 'FAIL',
      reason: String(form.Orderstatu_text ?? form.Errormsg ?? ''),
    };
  }
}
```

把 `backend/src/modules/suppliers/suppliers.service.ts` 的 `getAdapter` 改成：

```ts
import { ShenzhenKefeiAdapter } from '@/modules/suppliers/adapters/shenzhen-kefei.adapter';
```

并替换 `getAdapter` 内的分支：

```ts
if (supplier.supplierCode === 'mock-supplier') {
  return new MockSupplierAdapter(mode);
}

if (supplier.supplierCode === 'shenzhen-kefei') {
  const configJson = config?.configJson ?? {};
  const credential = JSON.parse(decryptText(config?.credentialEncrypted ?? '""')) as {
    agentAccount: string;
    md5Key: string;
  };

  return new ShenzhenKefeiAdapter({
    baseUrl: String(configJson.baseUrl ?? 'http://api.sohan.hk:50080/API'),
    agentAccount: credential.agentAccount,
    md5Key: credential.md5Key,
    callbackUrl: String(configJson.callbackUrl ?? ''),
  });
}
```

并在 `submitOrder` 调用适配器时补齐真实参数：

```ts
const submitResult = await adapter.submitOrder({
  orderNo: payload.orderNo,
  productId: order.matchedProductId,
  supplierProductCode: String(primarySupplier.supplierProductCode),
  mobile: order.mobile,
  faceValue: order.faceValue,
  ispName: order.ispName,
  province: order.province,
  callbackUrl: String((order.callbackSnapshotJson.callbackConfig as any)?.callbackUrl ?? ''),
});
```

在 `queryOrder` 调用时补入：

```ts
const queryResult = await adapter.queryOrder({
  supplierOrderNo: payload.supplierOrderNo,
  attemptIndex: payload.attemptIndex,
  orderNo: payload.orderNo,
});
```

- [ ] **Step 4: 运行适配器相关测试**

Run:

```bash
bun test tests/shenzhen-kefei-adapter.test.ts
```

Expected: PASS，余额查询、目录映射、充值受理测试全部通过。

- [ ] **Step 5: 提交真实适配器接入**

```bash
git add backend/src/modules/suppliers/adapters/types.ts backend/src/modules/suppliers/adapters/shenzhen-kefei.adapter.ts backend/src/modules/suppliers/contracts.ts backend/src/modules/suppliers/suppliers.service.ts backend/tests/shenzhen-kefei-adapter.test.ts
git commit -m "feat: wire shenzhen kefei supplier adapter"
```

### Task 3: 增加后台余额查询、目录同步与同步日志接口

**Files:**
- Modify: `backend/src/modules/suppliers/contracts.ts`
- Modify: `backend/src/modules/suppliers/suppliers.repository.ts`
- Modify: `backend/src/modules/suppliers/suppliers.routes.ts`
- Modify: `backend/src/modules/suppliers/suppliers.service.ts`
- Test: `backend/tests/suppliers-admin-kefei.test.ts`

- [ ] **Step 1: 先写后台联调接口失败测试**

创建 `backend/tests/suppliers-admin-kefei.test.ts`：

```ts
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { buildApp } from '@/app';
import { signJwt } from '@/lib/jwt-token';
import { env } from '@/lib/env';

let runtime: Awaited<ReturnType<typeof buildApp>>;

async function buildAdminAuth() {
  const token = await signJwt(
    {
      sub: 'seed-admin-user',
      type: 'admin',
      roleIds: ['SUPER_ADMIN'],
      scope: 'admin',
      jti: `itest-admin-${Date.now()}`,
    },
    env.adminJwtSecret,
    600,
  );

  return `Bearer ${token}`;
}

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

test('后台可查询供应商余额', async () => {
  const response = await runtime.app.handle(
    new Request('http://localhost/admin/suppliers/seed-supplier-mock/balance', {
      headers: {
        authorization: await buildAdminAuth(),
      },
    }),
  );

  expect(response.status).toBe(200);
});

test('后台可手工触发供应商商品同步', async () => {
  const response = await runtime.app.handle(
    new Request('http://localhost/admin/suppliers/seed-supplier-mock/catalog/sync', {
      method: 'POST',
      headers: {
        authorization: await buildAdminAuth(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
  );

  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: 运行测试确认新接口尚不存在**

Run:

```bash
bun test tests/suppliers-admin-kefei.test.ts
```

Expected: FAIL，至少有一条因为 `404` 或路由不存在失败。

- [ ] **Step 3: 扩展 service/repository/routes**

在 `backend/src/modules/suppliers/contracts.ts` 增加：

```ts
  getSupplierBalance(input: { supplierId: string }): Promise<{
    agentAccount: string;
    agentName?: string;
    agentBalance: number;
    agentProfit?: number;
    errorCode: number;
    errorDesc?: string;
  }>;
  triggerCatalogSync(input: { supplierId: string }): Promise<{
    syncedProducts: string[];
    supplierCode: string;
  }>;
  listSyncLogs(input: { supplierId: string }): Promise<SupplierSyncLog[]>;
```

在 `backend/src/modules/suppliers/suppliers.repository.ts` 增加：

```ts
  async listSyncLogsBySupplierId(supplierId: string): Promise<SupplierSyncLog[]> {
    const rows = await db<SupplierSyncLog[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        sync_type AS "syncType",
        status,
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        error_message AS "errorMessage",
        synced_at AS "syncedAt"
      FROM product.product_sync_logs
      WHERE supplier_id = ${supplierId}
      ORDER BY synced_at DESC
      LIMIT 50
    `;

    return rows.map((row) => this.mapSyncLog(row));
  }
```

在 `backend/src/modules/suppliers/suppliers.service.ts` 增加：

```ts
  async getSupplierBalance(input: { supplierId: string }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    const adapter = await this.getAdapter(supplier.supplierCode);

    if (!adapter.getBalance) {
      throw badRequest('当前供应商不支持余额查询');
    }

    return adapter.getBalance();
  }

  async triggerCatalogSync(input: { supplierId: string }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    const adapter = await this.getAdapter(supplier.supplierCode);

    if (!adapter.syncCatalog) {
      throw badRequest('当前供应商不支持目录同步');
    }

    const result = await adapter.syncCatalog();
    const synced = await this.syncFullCatalog({
      supplierCode: supplier.supplierCode,
      items: result.items,
    });

    return {
      supplierCode: supplier.supplierCode,
      syncedProducts: synced.syncedProducts,
    };
  }

  async listSyncLogs(input: { supplierId: string }) {
    return this.repository.listSyncLogsBySupplierId(input.supplierId);
  }
```

在 `backend/src/modules/suppliers/suppliers.routes.ts` 增加后台接口：

```ts
    .get(
      '/admin/suppliers/:supplierId/balance',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await suppliersService.getSupplierBalance({ supplierId: params.supplierId }));
      },
    )
    .post(
      '/admin/suppliers/:supplierId/catalog/sync',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await suppliersService.triggerCatalogSync({ supplierId: params.supplierId }));
      },
    )
    .get(
      '/admin/suppliers/:supplierId/sync-logs',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await suppliersService.listSyncLogs({ supplierId: params.supplierId }));
      },
    )
```

- [ ] **Step 4: 运行后台联调接口测试**

Run:

```bash
bun test tests/suppliers-admin-kefei.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交后台联调接口**

```bash
git add backend/src/modules/suppliers/contracts.ts backend/src/modules/suppliers/suppliers.repository.ts backend/src/modules/suppliers/suppliers.routes.ts backend/src/modules/suppliers/suppliers.service.ts backend/tests/suppliers-admin-kefei.test.ts
git commit -m "feat: add supplier balance and catalog sync apis"
```

### Task 4: 支持深圳科飞回调解析、验签和纯文本 OK 响应

**Files:**
- Modify: `backend/src/modules/suppliers/adapters/shenzhen-kefei.protocol.ts`
- Modify: `backend/src/modules/suppliers/adapters/shenzhen-kefei.adapter.ts`
- Modify: `backend/src/modules/suppliers/suppliers.service.ts`
- Modify: `backend/src/modules/suppliers/suppliers.routes.ts`
- Test: `backend/tests/suppliers-callback-kefei.test.ts`

- [ ] **Step 1: 先写失败测试，锁定 form 回调与 OK 响应**

创建 `backend/tests/suppliers-callback-kefei.test.ts`：

```ts
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { buildApp } from '@/app';

let runtime: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

test('深圳科飞回调成功时返回纯文本 OK', async () => {
  const body =
    'Action=CX&AgentAccount=JG18948358181&Orderid=ORD-1&Chargeid=CHARGE-1&Orderstatu_int=16&Orderstatu_text=%BD%C9%B7%D1%B3%C9%B9%A6&OrderPayment=100.00&Errorcode=0000&Errormsg=&Sign=stub';

  const response = await runtime.app.handle(
    new Request('http://localhost/callbacks/suppliers/shenzhen-kefei', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe('OK');
});
```

- [ ] **Step 2: 运行测试确认当前回调仍不兼容**

Run:

```bash
bun test tests/suppliers-callback-kefei.test.ts
```

Expected: FAIL，当前行为应仍返回 JSON 或因 schema 不匹配失败。

- [ ] **Step 3: 实现供应商分支回调解析**

在 `backend/src/modules/suppliers/suppliers.routes.ts` 将回调路由改为：

```ts
  const callbackRoutes = new Elysia({ prefix: '/callbacks/suppliers' }).post(
    '/:supplierCode',
    async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const contentType = request.headers.get('content-type') ?? '';
      const rawBody = await request.text();

      const parsedBody =
        contentType.includes('application/x-www-form-urlencoded')
          ? Object.fromEntries(new URLSearchParams(rawBody).entries())
          : (rawBody ? JSON.parse(rawBody) : {});

      await suppliersService.handleSupplierCallback(params.supplierCode, {
        headers: getHeadersJson(request.headers),
        body: parsedBody as Record<string, unknown>,
        rawBody,
        contentType,
      });

      if (params.supplierCode === 'shenzhen-kefei') {
        return new Response('OK', {
          status: 200,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'x-request-id': requestId,
          },
        });
      }

      return ok(requestId, { success: true });
    },
  );
```

在 `backend/src/modules/suppliers/suppliers.service.ts` 调整入参：

```ts
  async handleSupplierCallback(
    supplierCode: string,
    input: {
      headers: Record<string, unknown>;
      body: Record<string, unknown>;
      rawBody?: string;
      contentType?: string;
    },
  ) {
```

并在验签和解析处按供应商分支：

```ts
    const parsed = await adapter.parseCallback({
      headers: input.headers,
      body: input.body as Record<string, unknown>,
      rawBody: input.rawBody,
      contentType: input.contentType,
    });
```

把 `backend/src/modules/suppliers/adapters/shenzhen-kefei.adapter.ts` 的 `parseCallback` 实现改成：

```ts
import { verifyKefeiCallbackSign } from '@/modules/suppliers/adapters/shenzhen-kefei.protocol';

  async parseCallback(input: {
    headers: Record<string, unknown>;
    body: Record<string, unknown>;
    rawBody?: string;
    contentType?: string;
  }) {
    const form = parseKefeiCallbackForm(input.rawBody ?? '');
    const providedSign = String(form.Sign ?? input.headers.Sign ?? input.headers.sign ?? '');

    if (!verifyKefeiCallbackSign(form, this.options.md5Key, providedSign)) {
      throw new Error('深圳科飞回调签名校验失败');
    }

    const mapped = mapKefeiOrderStatus(String(form.Orderstatu_int ?? '0'));

    return {
      supplierOrderNo: String(form.Chargeid ?? ''),
      status: mapped.status === 'SUCCESS' ? 'SUCCESS' : 'FAIL',
      reason: String(form.Orderstatu_text ?? form.Errormsg ?? ''),
    };
  }
```

- [ ] **Step 4: 运行回调测试**

Run:

```bash
bun test tests/suppliers-callback-kefei.test.ts
```

Expected: PASS，返回 `OK`。

- [ ] **Step 5: 提交回调兼容**

```bash
git add backend/src/modules/suppliers/adapters/shenzhen-kefei.protocol.ts backend/src/modules/suppliers/adapters/shenzhen-kefei.adapter.ts backend/src/modules/suppliers/suppliers.service.ts backend/src/modules/suppliers/suppliers.routes.ts backend/tests/suppliers-callback-kefei.test.ts
git commit -m "feat: support shenzhen kefei callback flow"
```

### Task 5: 打通主路由接入与手工验收文档

**Files:**
- Modify: `backend/tests/order-flow-v1.test.ts`
- Create: `docs/shenzhen-kefei-manual-test.md`

- [ ] **Step 1: 写失败测试，锁定真实供应商能进入主路由**

在 `backend/tests/order-flow-v1.test.ts` 新增一个选择主映射的测试：

```ts
test('当深圳科飞映射优先级更高时开放下单主链路会选择它', async () => {
  await db`
    INSERT INTO supplier.suppliers (
      id, supplier_code, supplier_name, protocol_type, status
    ) VALUES (
      'itest-supplier-kefei',
      'shenzhen-kefei',
      '深圳科飞',
      'SOHAN_API',
      'ACTIVE'
    )
    ON CONFLICT (supplier_code) DO NOTHING
  `;

  await db`
    INSERT INTO product.product_supplier_mappings (
      id,
      product_id,
      supplier_id,
      supplier_product_code,
      route_type,
      priority,
      cost_price,
      sales_status,
      inventory_quantity,
      dynamic_updated_at,
      status
    ) VALUES (
      'itest-kefei-mapping',
      'seed-product-cmcc-mixed-50',
      'itest-supplier-kefei',
      '7001002',
      'PRIMARY',
      0,
      45,
      'ON_SALE',
      999999,
      NOW(),
      'ACTIVE'
    )
  `;

  const matched = await runtime.services.products.matchRechargeProduct({
    mobile: '13800130000',
    faceValue: 50,
    productType: 'MIXED',
  });

  expect(matched.supplierCandidates[0]?.supplierId).toBe('itest-supplier-kefei');
});
```

- [ ] **Step 2: 运行该测试，确认当前优先级切主逻辑可被验证**

Run:

```bash
bun test tests/order-flow-v1.test.ts -t "当深圳科飞映射优先级更高时开放下单主链路会选择它"
```

Expected: PASS。当前 `chooseSupplierCandidate` 已按 `priority ASC, costPrice ASC` 选择候选供应商，这个测试应证明“通过映射优先级切主”不需要额外改动产品匹配主逻辑。

- [ ] **Step 3: 写手工验收文档**

创建 `docs/shenzhen-kefei-manual-test.md`：

````md
# 深圳科飞手工验收步骤

## 1. 前置条件

- 系统已部署到白名单服务器
- 公网回调域名已配置为 `https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei`
- 已通过后台接口创建供应商：
  - `supplierCode = shenzhen-kefei`
  - `supplierName = 深圳科飞`
  - `protocolType = SOHAN_API`
- 已通过后台配置接口写入：
  - `agentAccount = JG18948358181`
  - `md5Key = F29C80BB80EA32D4`
  - `baseUrl = http://api.sohan.hk:50080/API`

## 2. 余额查询

```bash
curl -X GET 'https://admin.miigo.cn/admin/suppliers/<supplierId>/balance' \
  -H 'Authorization: Bearer <admin-token>'
```

预期：
- `code = 0`
- 返回 `agentBalance`
- 返回 `agentName`

## 3. 目录同步

```bash
curl -X POST 'https://admin.miigo.cn/admin/suppliers/<supplierId>/catalog/sync' \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

预期：
- `code = 0`
- `syncedProducts` 非空

## 4. 真实话费充值

```bash
curl -X POST 'https://admin.miigo.cn/open-api/orders' \
  -H 'AccessKey: <channel-access-key>' \
  -H 'Sign: <channel-sign>' \
  -H 'Timestamp: <timestamp>' \
  -H 'Nonce: <nonce>' \
  -H 'Content-Type: application/json' \
  -d '{
    "channelOrderNo": "kefei-itest-001",
    "mobile": "13800138000",
    "faceValue": 50,
    "product_type": "MIXED"
  }'
```

预期：
- 订单创建成功
- `supplier.submit` 任务入队
- 订单后续经回调或查单推进到终态
```
````

- [ ] **Step 4: 运行聚焦测试并检查文档**

Run:

```bash
bun test tests/shenzhen-kefei-adapter.test.ts tests/suppliers-admin-kefei.test.ts tests/suppliers-callback-kefei.test.ts
rg -n "深圳科飞|余额查询|目录同步|真实话费充值" docs/shenzhen-kefei-manual-test.md
```

Expected: 测试 PASS，文档关键章节可检索。

- [ ] **Step 5: 提交主路由验收文档**

```bash
git add backend/tests/order-flow-v1.test.ts docs/shenzhen-kefei-manual-test.md
git commit -m "docs: add shenzhen kefei manual verification guide"
```

## 自检清单

### Spec 覆盖

- Spec 中的协议差异收敛、余额查询、产品同步、开放下单真实充值、回调 `OK` 响应、按商品维度切主，都在 Task 1 到 Task 5 中有落点。
- 真实能力范围只覆盖余额、产品目录、话费充值、订单查询，没有把流量、权益、游戏或预下单带进计划。
- 手工验收链路“余额查询 -> 产品同步 -> 小额真实充值”已经在 Task 5 文档中固化。

### 占位检查

- 计划中没有使用任何未落实的占位语。
- 每个任务都给出了明确的文件路径、测试命令和预期结果。
- 所有 commit message 都已具体到任务范围。

### 类型与命名一致性

- 新供应商代码统一使用 `shenzhen-kefei`。
- 协议类型统一使用 `SOHAN_API`。
- 真实回调触发路径统一为 `/callbacks/suppliers/shenzhen-kefei`。
