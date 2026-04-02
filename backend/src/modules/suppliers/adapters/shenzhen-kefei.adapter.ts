import {
  buildKefeiPayload,
  decodeKefeiResponse,
  mapKefeiOrderStatus,
  parseKefeiCallbackForm,
  verifyKefeiCallbackSign,
} from '@/modules/suppliers/adapters/shenzhen-kefei.protocol';
import type {
  SupplierAdapter,
  SupplierBalanceResult,
  SupplierCatalogSyncResult,
} from '@/modules/suppliers/adapters/types';

interface ShenzhenKefeiAdapterOptions {
  baseUrl: string;
  agentAccount: string;
  md5Key: string;
  callbackUrl?: string;
  fetchImpl?: typeof fetch;
}

const allowedFaceValues = new Set([10, 30, 50, 100, 200]);
const excludedProductNameKeywords = [
  '流量',
  '省包',
  '日包',
  '月包',
  '年包',
  '国包',
  '全国包',
  '叠加包',
  '权益',
  '会员',
  '视频',
  '游戏',
  'q币',
  'q点',
  '加油卡',
  '天猫',
  '作废',
  '测试',
] as const;
const mainlandProvinceAliases = new Map<string, string>([
  ['北京', '北京'],
  ['北京市', '北京'],
  ['天津', '天津'],
  ['天津市', '天津'],
  ['河北', '河北'],
  ['河北省', '河北'],
  ['山西', '山西'],
  ['山西省', '山西'],
  ['内蒙古', '内蒙古'],
  ['内蒙古自治区', '内蒙古'],
  ['内蒙', '内蒙古'],
  ['辽宁', '辽宁'],
  ['辽宁省', '辽宁'],
  ['吉林', '吉林'],
  ['吉林省', '吉林'],
  ['黑龙江', '黑龙江'],
  ['黑龙江省', '黑龙江'],
  ['上海', '上海'],
  ['上海市', '上海'],
  ['江苏', '江苏'],
  ['江苏省', '江苏'],
  ['浙江', '浙江'],
  ['浙江省', '浙江'],
  ['安徽', '安徽'],
  ['安徽省', '安徽'],
  ['福建', '福建'],
  ['福建省', '福建'],
  ['江西', '江西'],
  ['江西省', '江西'],
  ['山东', '山东'],
  ['山东省', '山东'],
  ['河南', '河南'],
  ['河南省', '河南'],
  ['湖北', '湖北'],
  ['湖北省', '湖北'],
  ['湖南', '湖南'],
  ['湖南省', '湖南'],
  ['广东', '广东'],
  ['广东省', '广东'],
  ['广西', '广西'],
  ['广西壮族自治区', '广西'],
  ['海南', '海南'],
  ['海南省', '海南'],
  ['重庆', '重庆'],
  ['重庆市', '重庆'],
  ['四川', '四川'],
  ['四川省', '四川'],
  ['贵州', '贵州'],
  ['贵州省', '贵州'],
  ['云南', '云南'],
  ['云南省', '云南'],
  ['西藏', '西藏'],
  ['西藏自治区', '西藏'],
  ['陕西', '陕西'],
  ['陕西省', '陕西'],
  ['甘肃', '甘肃'],
  ['甘肃省', '甘肃'],
  ['青海', '青海'],
  ['青海省', '青海'],
  ['宁夏', '宁夏'],
  ['宁夏回族自治区', '宁夏'],
  ['新疆', '新疆'],
  ['新疆维吾尔自治区', '新疆'],
]);

function asString(input: unknown): string {
  return typeof input === 'string' ? input : String(input ?? '');
}

function asNumber(input: unknown): number {
  const value = Number(input ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeCarrierCode(input: string): string | null {
  const text = input.trim().toUpperCase();

  if (text === 'CMCC' || input.includes('移动')) {
    return 'CMCC';
  }

  if (text === 'CUCC' || input.includes('联通')) {
    return 'CUCC';
  }

  if (text === 'CTCC' || input.includes('电信')) {
    return 'CTCC';
  }

  if (text === 'CBN' || input.includes('广电')) {
    return 'CBN';
  }

  return null;
}

function normalizeProvinceName(input: string): string | null {
  const text = input.trim();

  if (!text || text === '全国') {
    return null;
  }

  return mainlandProvinceAliases.get(text) ?? null;
}

function isPureTalkRechargeName(input: string): boolean {
  const text = input.trim().toLowerCase();

  if (!text) {
    return false;
  }

  const containsTalkRechargeHint =
    text.includes('话费') ||
    text.includes('移动') ||
    text.includes('电信') ||
    text.includes('联通') ||
    text.includes('广电');

  if (!containsTalkRechargeHint) {
    return false;
  }

  return !excludedProductNameKeywords.some((keyword) => text.includes(keyword));
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

    if (!response.ok) {
      throw new Error(`深圳科飞请求失败: HTTP ${response.status}`);
    }

    const decoded = decodeKefeiResponse(await response.arrayBuffer());

    return JSON.parse(decoded) as T;
  }

  async getBalance(): Promise<SupplierBalanceResult> {
    const result = await this.request<Record<string, unknown>>(['action'], {
      action: 'YE',
    });

    return {
      agentAccount: asString(result.agentAccount),
      agentName: asString(result.agentName),
      agentBalance: asNumber(result.agentBalance),
      agentProfit: asNumber(result.agentProfit),
      errorCode: asNumber(result.errorCode),
      errorDesc: asString(result.errorDesc),
    };
  }

  async syncCatalog(): Promise<SupplierCatalogSyncResult> {
    const result = await this.request<{
      errorCode?: unknown;
      errorDesc?: unknown;
      dataset?: Array<Record<string, unknown>>;
    }>(['action'], {
      action: 'CHECK_SPU',
    });
    const errorCode = asNumber(result.errorCode);
    const errorDesc = asString(result.errorDesc);

    if (errorCode !== 1) {
      throw new Error(`深圳科飞目录同步失败: errorCode=${errorCode}, errorDesc=${errorDesc}`);
    }

    return {
      items: (result.dataset ?? []).flatMap((item) => {
        const productName = asString(item.itemName ?? item.spuName);
        const carrierCode = normalizeCarrierCode(asString(item.ispName));
        const provinceName = normalizeProvinceName(asString(item.province));
        const faceValue = asNumber(item.parValue ?? item.amount);

        if (
          !carrierCode ||
          !provinceName ||
          !allowedFaceValues.has(faceValue) ||
          !isPureTalkRechargeName(productName)
        ) {
          return [];
        }

        const discount = asNumber(item.discount);
        const purchasePriceRaw = item.inPrice ?? item.purchasePrice;
        const purchasePrice =
          purchasePriceRaw !== undefined && purchasePriceRaw !== null
            ? asNumber(purchasePriceRaw)
            : (faceValue * discount) / 100;
        const supplierProductCode = asString(item.itemId ?? item.productSn);

        return [
          {
            productCode: `${carrierCode.toLowerCase()}-${provinceName}-${faceValue}`,
            productName,
            carrierCode,
            provinceName,
            faceValue,
            rechargeMode: 'MIXED',
            purchasePrice,
            inventoryQuantity: asNumber(item.stock ?? item.inventoryQuantity ?? 999999),
            supplierProductCode,
            salesStatus: asString(item.salesStatus ?? 'ON_SALE'),
            routeType: 'PRIMARY',
            priority: 0,
            mappingStatus: 'ACTIVE',
          },
        ];
      }),
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
    const result = await this.request<Record<string, unknown>>(
      [
        'action',
        'orderId',
        'chargeAcct',
        'chargeCash',
        'chargeType',
        'ispName',
        'province',
        'retUrl',
      ],
      {
        action: 'CZ',
        orderId: input.orderNo,
        chargeAcct: input.mobile ?? '',
        chargeCash: String(input.faceValue ?? ''),
        chargeType: '0',
        ispName: encodeURIComponent(input.ispName ?? ''),
        province: input.province ?? '',
        retUrl: encodeURIComponent(input.callbackUrl ?? this.options.callbackUrl ?? ''),
      },
    );

    const errorCode = asNumber(result.errorCode);
    const errorDesc = asString(result.errorDesc);

    if (errorCode === -310) {
      return {
        supplierOrderNo: asString(result.chargeId || input.orderNo),
        status: 'PROCESSING' as const,
        rawCode: errorCode,
        rawMessage: errorDesc,
      };
    }

    if (errorCode !== 1) {
      throw new Error(errorDesc || `深圳科飞下单失败: ${errorCode}`);
    }

    return {
      supplierOrderNo: asString(result.chargeId),
      status: 'ACCEPTED' as const,
      rawCode: errorCode,
      rawMessage: errorDesc,
    };
  }

  async queryOrder(input: { supplierOrderNo: string; attemptIndex: number; orderNo?: string }) {
    const result = await this.request<Record<string, unknown>>(['action', 'orderId'], {
      action: 'CX',
      orderId: input.orderNo ?? input.supplierOrderNo,
    });
    const rawStatusCode = asString(result.orderStatuInt ?? result.orderStatusInt ?? '0');
    const mapped = mapKefeiOrderStatus(rawStatusCode);

    return {
      status: mapped.status,
      reason: asString(result.errorDesc ?? result.orderStatuText),
      rawStatusCode,
    };
  }

  async parseCallback(input: {
    headers?: Record<string, unknown>;
    body: Record<string, unknown>;
    rawBody?: string;
    contentType?: string;
  }) {
    const form = input.rawBody
      ? parseKefeiCallbackForm(input.rawBody)
      : Object.fromEntries(
          Object.entries(input.body).map(([key, value]) => [key, asString(value)]),
        );
    const providedSign = asString(form.Sign ?? input.body.Sign ?? '');
    const mapped = mapKefeiOrderStatus(asString(form.Orderstatu_int ?? '0'));
    const signatureValid = Boolean(
      providedSign && verifyKefeiCallbackSign(form, this.options.md5Key, providedSign),
    );

    return {
      supplierOrderNo: asString(form.Chargeid ?? form.chargeId ?? form.supplierOrderNo),
      status:
        mapped.status === 'SUCCESS'
          ? ('SUCCESS' as const)
          : mapped.status === 'FAIL'
            ? ('FAIL' as const)
            : ('SUCCESS' as const),
      reason: asString(form.Orderstatu_text ?? form.Errormsg),
      mappedStatus: mapped.status,
      signatureValid,
    };
  }
}
