export interface Channel {
  id: string;
  channelCode: string;
  channelName: string;
  channelType: string;
  status: string;
  settlementMode: string;
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

export interface OpenChannelContext {
  channel: Channel;
  credential: ChannelCredential;
}

export interface OrderPolicy {
  channel: Channel;
  callbackConfig: ChannelCallbackConfig;
  limitRule: ChannelLimitRule | null;
  pricePolicy: ChannelPricePolicy | null;
}
