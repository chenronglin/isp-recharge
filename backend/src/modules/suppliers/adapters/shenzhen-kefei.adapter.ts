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

function asString(input: unknown): string {
  return typeof input === 'string' ? input : String(input ?? '');
}

function asNumber(input: unknown): number {
  const value = Number(input ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeCarrierCode(input: string): string {
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

  return text || 'CBN';
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
      items: (result.dataset ?? []).map((item) => {
        const carrierCode = normalizeCarrierCode(asString(item.ispName));
        const provinceName = asString(item.province);
        const faceValue = asNumber(item.parValue ?? item.amount);
        const discount = asNumber(item.discount);
        const purchasePriceRaw = item.inPrice ?? item.purchasePrice;
        const purchasePrice =
          purchasePriceRaw !== undefined && purchasePriceRaw !== null
            ? asNumber(purchasePriceRaw)
            : (faceValue * discount) / 100;
        const supplierProductCode = asString(item.itemId ?? item.productSn);

        return {
          productCode: `${carrierCode.toLowerCase()}-${provinceName}-${faceValue}`,
          productName: asString(item.itemName ?? item.spuName),
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
        };
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
