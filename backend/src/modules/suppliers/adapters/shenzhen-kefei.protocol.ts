import { createHash, timingSafeEqual } from 'node:crypto';
import iconv from 'iconv-lite';

export function buildKefeiSign(busiBodyText: string, md5Key: string): string {
  return createHash('md5').update(`${busiBodyText}${md5Key}`, 'utf8').digest('hex');
}

export function buildKefeiPayload(input: {
  agentAccount: string;
  md5Key: string;
  busiBody: Record<string, unknown>;
  fieldOrder: string[];
}) {
  const orderedEntries = input.fieldOrder.map((key) => {
    if (
      !Object.prototype.hasOwnProperty.call(input.busiBody, key) ||
      input.busiBody[key] === undefined
    ) {
      throw new Error(`missing required busiBody field '${key}'`);
    }

    return [key, input.busiBody[key]] as const;
  });
  const busiBodyObject = Object.fromEntries(orderedEntries);
  const busiBodyText = JSON.stringify(busiBodyObject);
  const sign = buildKefeiSign(busiBodyText, input.md5Key);

  return {
    sign,
    agentAccount: input.agentAccount,
    busiBody: busiBodyObject,
    busiBodyText,
    bodyBuffer: iconv.encode(
      JSON.stringify({
        sign,
        agentAccount: input.agentAccount,
        busiBody: busiBodyObject,
      }),
      'gbk',
    ),
  };
}

export function decodeKefeiResponse(input: ArrayBuffer | Buffer): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return iconv.decode(buffer, 'gbk');
}

export function mapKefeiOrderStatus(
  code: string,
): {
  status: 'QUERYING' | 'SUCCESS' | 'FAIL';
} {
  if (['11', '16'].includes(code)) {
    return { status: 'SUCCESS' };
  }

  if (['20', '21', '26', '35'].includes(code)) {
    return { status: 'FAIL' };
  }

  return { status: 'QUERYING' };
}

export function parseKefeiCallbackForm(formText: string): Record<string, string> {
  const params = new URLSearchParams(formText);
  return Object.fromEntries(params.entries());
}

export function verifyKefeiCallbackSign(
  form: Record<string, string>,
  md5Key: string,
  providedSign: string,
): boolean {
  const errorCode = form.Errorcode ?? '0000';
  const raw = `Orderid=${form.Orderid}&Chargeid=${form.Chargeid}&Orderstatu_int=${form.Orderstatu_int}&Errorcode=${errorCode}&Password=${md5Key}`;
  const expectedSign = createHash('md5').update(raw, 'utf8').digest('hex');
  const expected = Buffer.from(expectedSign.toLowerCase(), 'utf8');
  const provided = Buffer.from(String(providedSign).toLowerCase(), 'utf8');

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
