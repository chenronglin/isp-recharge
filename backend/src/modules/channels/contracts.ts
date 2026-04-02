import type { OpenChannelContext, OrderPolicy } from '@/modules/channels/channels.types';

export interface ChannelContract {
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
  getChannelById(channelId: string): Promise<OrderPolicy['channel']>;
}
