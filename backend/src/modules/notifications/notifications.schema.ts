import { t } from 'elysia';

export const CreateNotificationBodySchema = t.Object({
  orderNo: t.String(),
  channelId: t.String(),
  notifyType: t.String({ minLength: 1 }),
  destination: t.String({ minLength: 1 }),
  payload: t.Record(t.String(), t.Unknown()),
});
