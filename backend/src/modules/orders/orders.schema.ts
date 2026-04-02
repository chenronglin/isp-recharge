import { t } from 'elysia';

export const CreateOrderBodySchema = t.Object({
  channelOrderNo: t.String({ minLength: 1 }),
  mobile: t.String({ pattern: '^\\d{11}$' }),
  faceValue: t.Number({ minimum: 1 }),
  product_type: t.Optional(t.Union([t.Literal('FAST'), t.Literal('MIXED')])),
  ext: t.Optional(t.Record(t.String(), t.Unknown())),
});

export const RemarkBodySchema = t.Object({
  remark: t.String({ minLength: 1 }),
});

export const MarkExceptionBodySchema = t.Object({
  exceptionTag: t.String({ minLength: 1 }),
});
