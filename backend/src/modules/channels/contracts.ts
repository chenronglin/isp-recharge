import type { OpenChannelContext, OrderPolicy } from '@/modules/channels/channels.types';

export interface ChannelContract {
  resolveChannelAuthContext(input: {
    authorization?: string | null;
    accessKey: string;
    signature: string;
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    bodyText: string;
  }): Promise<OpenChannelContext>;
  authenticateOpenRequest(input: {
    accessKey: string;
    signature: string;
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    bodyText: string;
  }): Promise<OpenChannelContext>;
  getOrderPolicy(input: {
    channelId: string;
    productId: string;
    orderAmount: number;
  }): Promise<OrderPolicy>;
  getCallbackConfig(channelId: string): Promise<OrderPolicy['callbackConfig']>;
  getChannelById(channelId: string): Promise<Record<string, unknown>>;
}
