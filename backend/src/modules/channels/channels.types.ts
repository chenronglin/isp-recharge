export interface Channel {
  id: string;
  channelCode: string;
  channelName: string;
  channelType: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  baseUrl: string | null;
  protocolType: string;
  accessAccount: string | null;
  accessPasswordHash: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  cooperationStatus: string;
  supportsConsumptionLog: boolean;
  settlementMode: string;
  status: string;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelCredential {
  id: string;
  channelId: string;
  accessKey: string;
  secretKeyEncrypted: string;
  signAlgorithm: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelCallbackConfig {
  id: string;
  channelId: string;
  callbackUrl: string;
  signType: string;
  secretEncrypted: string;
  retryEnabled: boolean;
  timeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelPricePolicy {
  id: string;
  channelId: string;
  productId: string;
  salePrice: number;
  currency: string;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface ChannelLimitRule {
  id: string;
  channelId: string;
  singleLimit: number;
  dailyLimit: number;
  monthlyLimit: number;
  qpsLimit: number;
}

export interface ChannelSplitPolicy {
  id: string;
  channelId: string;
  enabled: boolean;
  allowedFaceValues: number[];
  preferMaxSingleFaceValue: boolean;
  maxSplitPieces: number;
  provinceOverride: string | null;
  carrierOverride: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelPortalSession {
  id: string;
  channelId: string;
  accessTokenHash: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelRechargeRecord {
  recordId: string;
  channelId: string;
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  currency: string;
  recordSource: string;
  remark: string | null;
  operatorUserId: string | null;
  operatorUsername: string | null;
  createdAt: string;
}

export interface ChannelProductRecord {
  channelId: string;
  productId: string;
  productCode?: string | null;
  productName: string;
  carrierCode: string;
  province: string;
  faceValue: number;
  productType?: string | null;
  salePrice: number | null;
  authorized: boolean;
  routeSupplierId: string | null;
  routeSupplierName: string | null;
  routeSupplierProductCode?: string | null;
  routeCostPrice?: number | null;
  latestSnapshotAt: string | null;
  status: string;
}

export interface ChannelBalanceRecord {
  channelId: string;
  availableBalance: number;
  frozenBalance: number;
  currency: string;
  status: string;
  updatedAt: string | null;
}

export interface OpenChannelContext {
  channel: Channel;
  authType: 'SIGN' | 'PORTAL';
  credential: ChannelCredential | null;
}

export interface OrderPolicy {
  channel: Channel;
  callbackConfig: ChannelCallbackConfig;
  limitRule: ChannelLimitRule | null;
  pricePolicy: ChannelPricePolicy | null;
}
