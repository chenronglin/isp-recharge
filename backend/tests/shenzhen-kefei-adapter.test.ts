import { describe, expect, test } from 'bun:test';
import iconv from 'iconv-lite';
import { ShenzhenKefeiAdapter } from '@/modules/suppliers/adapters/shenzhen-kefei.adapter';
import {
  buildKefeiPayload,
  buildKefeiSign,
  decodeKefeiResponse,
  mapKefeiOrderStatus,
  parseKefeiCallbackForm,
  verifyKefeiCallbackSign,
} from '@/modules/suppliers/adapters/shenzhen-kefei.protocol';

function createMockFetch(responseFactory: () => Response): typeof fetch {
  return (async () => responseFactory()) as unknown as typeof fetch;
}

function gbkJsonResponse(payload: unknown): Response {
  return new Response(new Uint8Array(iconv.encode(JSON.stringify(payload), 'gbk')));
}

describe('shenzhen kefei protocol primitives', () => {
  test('buildKefeiPayload builds stable busiBodyText and sign', () => {
    const payload = buildKefeiPayload({
      agentAccount: 'JG18948358181',
      md5Key: 'F29C80BB80EA32D4',
      busiBody: { ignored: 'x', action: 'YE' },
      fieldOrder: ['action'],
    });

    expect(payload.agentAccount).toBe('JG18948358181');
    expect(payload.busiBodyText).toBe('{"action":"YE"}');
    expect(payload.sign).toBe('46d780dce5b7c48c078ec827a7fc9230');
    expect(payload.sign).toBe(buildKefeiSign(payload.busiBodyText, 'F29C80BB80EA32D4'));
  });

  test('buildKefeiPayload throws when fieldOrder contains missing field', () => {
    expect(() =>
      buildKefeiPayload({
        agentAccount: 'JG18948358181',
        md5Key: 'F29C80BB80EA32D4',
        busiBody: {},
        fieldOrder: ['action'],
      }),
    ).toThrow("missing required busiBody field 'action'");
  });

  test('mapKefeiOrderStatus maps known status codes', () => {
    expect(mapKefeiOrderStatus('0')).toEqual({ status: 'QUERYING' });
    expect(mapKefeiOrderStatus('16')).toEqual({ status: 'SUCCESS' });
    expect(mapKefeiOrderStatus('35')).toEqual({ status: 'FAIL' });
  });

  test('parseKefeiCallbackForm + verifyKefeiCallbackSign parses and verifies form callback', () => {
    const formText =
      'Action=CX&AgentAccount=JG18948358181&Orderid=T1001&Chargeid=2893131209&Orderstatu_int=16&Orderstatu_text=%BD%C9%B7%D1%B3%C9%B9%A6&OrderPayment=10.00&Errorcode=1001&Errormsg=BUSINESS_FAIL&Sign=b46a25cc3d577d087994bb03d6570a56';
    const parsed = parseKefeiCallbackForm(formText);

    expect(parsed.Orderid).toBe('T1001');
    expect(parsed.Orderstatu_int).toBe('16');
    expect(parsed.Errorcode).toBe('1001');
    expect(verifyKefeiCallbackSign(parsed, '13D5C4F4910EDC34', parsed.Sign)).toBe(true);
  });

  test('decodeKefeiResponse decodes GBK response bytes', () => {
    const gbkResponse = Buffer.from([
      0x7b, 0x22, 0x65, 0x72, 0x72, 0x6f, 0x72, 0x43, 0x6f, 0x64, 0x65, 0x22, 0x3a, 0x31, 0x2c,
      0x22, 0x65, 0x72, 0x72, 0x6f, 0x72, 0x44, 0x65, 0x73, 0x63, 0x22, 0x3a, 0x22, 0xb2, 0xd9,
      0xd7, 0xf7, 0xb3, 0xc9, 0xb9, 0xa6, 0x22, 0x7d,
    ]);
    const decoded = decodeKefeiResponse(gbkResponse);

    expect(decoded).toContain('"errorCode":1');
    expect(decoded).toContain('"errorDesc":"操作成功"');
  });
});

describe('shenzhen kefei adapter', () => {
  test('getBalance returns normalized supplier balance', async () => {
    const originFetch = globalThis.fetch;
    globalThis.fetch = createMockFetch(() =>
      gbkJsonResponse({
        errorCode: 1,
        errorDesc: 'success',
        agentAccount: 'JG18948358181',
        agentName: '深圳科飞',
        agentBalance: 188.6,
        agentProfit: 23.4,
      }),
    );

    try {
      const adapter = new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key: 'F29C80BB80EA32D4',
      });
      const result = await adapter.getBalance();

      expect(result).toEqual({
        errorCode: 1,
        errorDesc: 'success',
        agentAccount: 'JG18948358181',
        agentName: '深圳科飞',
        agentBalance: 188.6,
        agentProfit: 23.4,
      });
    } finally {
      globalThis.fetch = originFetch;
    }
  });

  test('syncCatalog maps upstream dataset to platform items', async () => {
    const originFetch = globalThis.fetch;
    globalThis.fetch = createMockFetch(() =>
      gbkJsonResponse({
        errorCode: 1,
        dataset: [
          {
            itemId: 'kefei-cmcc-gd-50',
            itemName: '广东移动 50 元',
            ispName: 'CMCC',
            province: '广东',
            parValue: 50,
            inPrice: 47.25,
            stock: 88,
            salesStatus: 'ON_SALE',
          },
        ],
      }),
    );

    try {
      const adapter = new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key: 'F29C80BB80EA32D4',
      });
      const result = await adapter.syncCatalog();

      expect(result.items).toEqual([
        {
          productCode: 'cmcc-广东-50',
          productName: '广东移动 50 元',
          carrierCode: 'CMCC',
          provinceName: '广东',
          faceValue: 50,
          rechargeMode: 'MIXED',
          purchasePrice: 47.25,
          inventoryQuantity: 88,
          supplierProductCode: 'kefei-cmcc-gd-50',
          salesStatus: 'ON_SALE',
          routeType: 'PRIMARY',
          priority: 0,
          mappingStatus: 'ACTIVE',
        },
      ]);
    } finally {
      globalThis.fetch = originFetch;
    }
  });

  test('syncCatalog filters non-voice, non-mainland, unsupported amount items and normalizes province aliases', async () => {
    const originFetch = globalThis.fetch;
    globalThis.fetch = createMockFetch(() =>
      gbkJsonResponse({
        errorCode: 1,
        dataset: [
          {
            itemId: 'kefei-valid-cmcc-gd-50',
            itemName: '广东移动50元',
            ispName: '移动',
            province: '广东',
            amount: 50,
            discount: 94.5,
            stock: 88,
            salesStatus: 'ON_SALE',
          },
          {
            itemId: 'kefei-invalid-flow',
            itemName: '广东移动国包流量60G',
            ispName: '移动',
            province: '广东',
            amount: 10,
            inPrice: 9.5,
            stock: 99,
            salesStatus: 'ON_SALE',
          },
          {
            itemId: 'kefei-invalid-qcoin',
            itemName: '腾讯Q币直通车按元直充【内蒙古】',
            ispName: '移动',
            province: '内蒙',
            amount: 30,
            inPrice: 28.5,
            stock: 99,
            salesStatus: 'ON_SALE',
          },
          {
            itemId: 'kefei-invalid-national',
            itemName: '全国电信100元',
            ispName: '电信',
            province: '全国',
            amount: 100,
            inPrice: 96,
            stock: 99,
            salesStatus: 'ON_SALE',
          },
          {
            itemId: 'kefei-invalid-unknown',
            itemName: '壳牌加油卡10元',
            ispName: '未知',
            province: '广东',
            amount: 10,
            inPrice: 9.2,
            stock: 99,
            salesStatus: 'ON_SALE',
          },
          {
            itemId: 'kefei-invalid-zero',
            itemName: '浙江电信3',
            ispName: '电信',
            province: '浙江',
            amount: 0,
            inPrice: 0,
            stock: 99,
            salesStatus: 'ON_SALE',
          },
          {
            itemId: 'kefei-valid-cucc-nmg-30',
            itemName: '内蒙联通30元',
            ispName: '联通',
            province: '内蒙',
            amount: 30,
            inPrice: 28.8,
            stock: 77,
            salesStatus: 'ON_SALE',
          },
        ],
      }),
    );

    try {
      const adapter = new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key: 'F29C80BB80EA32D4',
      });
      const result = await adapter.syncCatalog();

      expect(result.items).toEqual([
        {
          productCode: 'cmcc-广东-50',
          productName: '广东移动50元',
          carrierCode: 'CMCC',
          provinceName: '广东',
          faceValue: 50,
          rechargeMode: 'MIXED',
          purchasePrice: 47.25,
          inventoryQuantity: 88,
          supplierProductCode: 'kefei-valid-cmcc-gd-50',
          salesStatus: 'ON_SALE',
          routeType: 'PRIMARY',
          priority: 0,
          mappingStatus: 'ACTIVE',
        },
        {
          productCode: 'cucc-内蒙古-30',
          productName: '内蒙联通30元',
          carrierCode: 'CUCC',
          provinceName: '内蒙古',
          faceValue: 30,
          rechargeMode: 'MIXED',
          purchasePrice: 28.8,
          inventoryQuantity: 77,
          supplierProductCode: 'kefei-valid-cucc-nmg-30',
          salesStatus: 'ON_SALE',
          routeType: 'PRIMARY',
          priority: 0,
          mappingStatus: 'ACTIVE',
        },
      ]);
    } finally {
      globalThis.fetch = originFetch;
    }
  });

  test('syncCatalog throws when upstream CHECK_SPU returns non-success errorCode', async () => {
    const originFetch = globalThis.fetch;
    globalThis.fetch = createMockFetch(() =>
      gbkJsonResponse({
        errorCode: -301,
        errorDesc: 'catalog temporarily unavailable',
        dataset: [],
      }),
    );

    try {
      const adapter = new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key: 'F29C80BB80EA32D4',
      });
      await expect(adapter.syncCatalog()).rejects.toThrow('-301');
      await expect(adapter.syncCatalog()).rejects.toThrow('catalog temporarily unavailable');
    } finally {
      globalThis.fetch = originFetch;
    }
  });

  test('submitOrder returns ACCEPTED and chargeId when errorCode is 1', async () => {
    const originFetch = globalThis.fetch;
    globalThis.fetch = createMockFetch(
      () =>
        new Response(
          new TextEncoder().encode(
            JSON.stringify({
              errorCode: 1,
              errorDesc: 'success',
              chargeId: 'KF202603310001',
            }),
          ),
        ),
    );

    try {
      const adapter = new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key: 'F29C80BB80EA32D4',
      });
      const result = await adapter.submitOrder({
        orderNo: 'ORD202603310001',
        productId: 'prod-1',
        supplierProductCode: 'kefei-cmcc-gd-50',
        mobile: '13800138000',
        faceValue: 50,
        ispName: 'CMCC',
        province: '广东',
        callbackUrl: 'https://api.example.com/callback',
      });

      expect(result).toEqual({
        supplierOrderNo: 'KF202603310001',
        status: 'ACCEPTED',
        rawCode: 1,
        rawMessage: 'success',
      });
    } finally {
      globalThis.fetch = originFetch;
    }
  });
});
