import { describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { eventBus } from '@/lib/event-bus';
import { ShenzhenKefeiAdapter } from '@/modules/suppliers/adapters/shenzhen-kefei.adapter';
import { createSuppliersRoutes } from '@/modules/suppliers/suppliers.routes';
import { SuppliersService } from '@/modules/suppliers/suppliers.service';

function buildKefeiSign(input: {
  orderId: string;
  chargeId: string;
  orderStatus: string;
  errorCode?: string;
  md5Key: string;
}) {
  const errorCode = input.errorCode ?? '0000';
  const signRaw = `Orderid=${input.orderId}&Chargeid=${input.chargeId}&Orderstatu_int=${input.orderStatus}&Errorcode=${errorCode}&Password=${input.md5Key}`;
  return createHash('md5').update(signRaw, 'utf8').digest('hex');
}

class TestSuppliersService extends SuppliersService {
  constructor(
    repository: Record<string, unknown>,
    private readonly adapter: ShenzhenKefeiAdapter,
  ) {
    super(
      repository as never,
      {
        async getSupplierExecutionContext() {
          return {
            purchasePrice: 47.25,
          };
        },
      } as never,
      {} as never,
    );
  }

  override async getAdapter() {
    return this.adapter;
  }
}

describe('shenzhen kefei callback route', () => {
  test('POST /callbacks/suppliers/shenzhen-kefei 接收 form-urlencoded 并返回纯文本 OK', async () => {
    const handleSupplierCallback = mock(() => Promise.resolve());
    const app = createSuppliersRoutes({
      suppliersService: {
        handleSupplierCallback,
      } as never,
      iamService: {} as never,
    });

    const rawBody =
      'Action=CX&Orderid=T202603310001&Chargeid=KF202603310001&Orderstatu_int=16&Orderstatu_text=success&Errorcode=0000&Errormsg=ok&Sign=abc123';
    const response = await app.handle(
      new Request('http://localhost/callbacks/suppliers/shenzhen-kefei', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe('OK');
    expect(handleSupplierCallback).toHaveBeenCalledTimes(1);
    expect(handleSupplierCallback).toHaveBeenCalledWith('shenzhen-kefei', {
      headers: expect.objectContaining({
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      }),
      body: expect.objectContaining({
        Chargeid: 'KF202603310001',
        Orderstatu_int: '16',
        Sign: 'abc123',
      }),
      rawBody,
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    });
  });

  test('POST /callbacks/suppliers/mock-supplier 仍返回 JSON success envelope', async () => {
    const handleSupplierCallback = mock(() => Promise.resolve());
    const app = createSuppliersRoutes({
      suppliersService: {
        handleSupplierCallback,
      } as never,
      iamService: {} as never,
    });

    const response = await app.handle(
      new Request('http://localhost/callbacks/suppliers/mock-supplier', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          supplierOrderNo: 'mock-order-1',
          status: 'SUCCESS',
        }),
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: { success: boolean };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(payload.code).toBe(0);
    expect(payload.data).toEqual({ success: true });
  });

  test('POST /callbacks/suppliers/mock-supplier JSON 非法时返回 400，且不下沉到 service', async () => {
    const handleSupplierCallback = mock(() => Promise.resolve());
    const app = createSuppliersRoutes({
      suppliersService: {
        handleSupplierCallback,
      } as never,
      iamService: {} as never,
    });

    const response = await app.handle(
      new Request('http://localhost/callbacks/suppliers/mock-supplier', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: '{"supplierOrderNo":"mock-order-1"',
      }),
    );

    expect(response.status).toBe(400);
    expect(handleSupplierCallback).toHaveBeenCalledTimes(0);
  });
});

describe('shenzhen kefei callback service flow', () => {
  test('验签通过且状态映射成功时会进入 supplier callback 成功处理路径', async () => {
    const md5Key = '13D5C4F4910EDC34';
    const sign = buildKefeiSign({
      orderId: 'T202603310002',
      chargeId: 'KF202603310002',
      orderStatus: '16',
      errorCode: '0000',
      md5Key,
    });
    const rawBody = `Action=CX&Orderid=T202603310002&Chargeid=KF202603310002&Orderstatu_int=16&Orderstatu_text=success&Errorcode=0000&Errormsg=ok&Sign=${sign}`;
    const updateSupplierOrderStatus = mock(() => Promise.resolve());
    const addCallbackLog = mock(() => Promise.resolve());
    const publishMock = mock(() => Promise.resolve());
    const originPublish = eventBus.publish.bind(eventBus);
    (eventBus.publish as unknown) = publishMock;
    const service = new TestSuppliersService(
      {
        async findSupplierByCode() {
          return { id: 'supplier-kefei', supplierCode: 'shenzhen-kefei' };
        },
        async findConfigBySupplierId() {
          return null;
        },
        async findSupplierOrderBySupplierOrderNo() {
          return {
            orderNo: 'ORD202603310002',
            supplierId: 'supplier-kefei',
            supplierOrderNo: 'KF202603310002',
          };
        },
        addCallbackLog,
        updateSupplierOrderStatus,
      },
      new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key,
      }),
    );

    try {
      await service.handleSupplierCallback('shenzhen-kefei', {
        headers: {},
        body: {},
        rawBody,
        contentType: 'application/x-www-form-urlencoded; charset=utf-8',
      });
    } finally {
      (eventBus.publish as unknown) = originPublish;
    }

    expect(addCallbackLog).toHaveBeenCalledTimes(1);
    expect(addCallbackLog).toHaveBeenCalledWith(
      expect.objectContaining({
        signatureValid: true,
        parsedStatus: 'SUCCESS',
      }),
    );
    expect(updateSupplierOrderStatus).toHaveBeenCalledWith('KF202603310002', 'SUCCESS', {
      from: 'callback',
    });
    expect(publishMock).toHaveBeenCalledWith('SupplierSucceeded', {
      orderNo: 'ORD202603310002',
      supplierId: 'supplier-kefei',
      supplierOrderNo: 'KF202603310002',
      costPrice: 47.25,
    });
  });

  test('验签失败时会先写 callback log(signatureValid=false) 再拒绝', async () => {
    const md5Key = '13D5C4F4910EDC34';
    const rawBody =
      'Action=CX&Orderid=T202603310003&Chargeid=KF202603310003&Orderstatu_int=16&Orderstatu_text=success&Errorcode=0000&Errormsg=ok&Sign=bad-sign';
    const addCallbackLog = mock(() => Promise.resolve());
    const updateSupplierOrderStatus = mock(() => Promise.resolve());
    const service = new TestSuppliersService(
      {
        async findSupplierByCode() {
          return { id: 'supplier-kefei', supplierCode: 'shenzhen-kefei' };
        },
        async findSupplierOrderBySupplierOrderNo() {
          return {
            orderNo: 'ORD202603310003',
            supplierId: 'supplier-kefei',
            supplierOrderNo: 'KF202603310003',
          };
        },
        addCallbackLog,
        updateSupplierOrderStatus,
      },
      new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key,
      }),
    );

    await expect(
      service.handleSupplierCallback('shenzhen-kefei', {
        headers: {},
        body: {},
        rawBody,
        contentType: 'application/x-www-form-urlencoded; charset=utf-8',
      }),
    ).rejects.toThrow('签名');

    expect(addCallbackLog).toHaveBeenCalledTimes(1);
    expect(addCallbackLog).toHaveBeenCalledWith(
      expect.objectContaining({
        signatureValid: false,
      }),
    );
    expect(updateSupplierOrderStatus).toHaveBeenCalledTimes(0);
  });

  test('QUERYING 非终态回调不会被误判失败，会更新为 QUERYING 并发布 SupplierAccepted(PROCESSING)', async () => {
    const md5Key = '13D5C4F4910EDC34';
    const sign = buildKefeiSign({
      orderId: 'T202603310004',
      chargeId: 'KF202603310004',
      orderStatus: '0',
      errorCode: '0000',
      md5Key,
    });
    const rawBody = `Action=CX&Orderid=T202603310004&Chargeid=KF202603310004&Orderstatu_int=0&Orderstatu_text=querying&Errorcode=0000&Errormsg=ok&Sign=${sign}`;
    const updateSupplierOrderStatus = mock(() => Promise.resolve());
    const addCallbackLog = mock(() => Promise.resolve());
    const publishMock = mock(() => Promise.resolve());
    const originPublish = eventBus.publish.bind(eventBus);
    (eventBus.publish as unknown) = publishMock;
    const service = new TestSuppliersService(
      {
        async findSupplierByCode() {
          return { id: 'supplier-kefei', supplierCode: 'shenzhen-kefei' };
        },
        async findSupplierOrderBySupplierOrderNo() {
          return {
            orderNo: 'ORD202603310004',
            supplierId: 'supplier-kefei',
            supplierOrderNo: 'KF202603310004',
          };
        },
        addCallbackLog,
        updateSupplierOrderStatus,
      },
      new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key,
      }),
    );

    try {
      await service.handleSupplierCallback('shenzhen-kefei', {
        headers: {},
        body: {},
        rawBody,
        contentType: 'application/x-www-form-urlencoded; charset=utf-8',
      });
    } finally {
      (eventBus.publish as unknown) = originPublish;
    }

    expect(addCallbackLog).toHaveBeenCalledWith(
      expect.objectContaining({
        signatureValid: true,
      }),
    );
    expect(updateSupplierOrderStatus).toHaveBeenCalledWith('KF202603310004', 'QUERYING', {
      from: 'callback',
    });
    expect(publishMock).toHaveBeenCalledWith('SupplierAccepted', {
      orderNo: 'ORD202603310004',
      supplierId: 'supplier-kefei',
      supplierOrderNo: 'KF202603310004',
      status: 'PROCESSING',
    });
  });
});
