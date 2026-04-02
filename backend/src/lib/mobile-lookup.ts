import { badRequest, notFound } from '@/lib/errors';
import { db, first } from '@/lib/sql';

export interface MobileLookupResult {
  mobile: string;
  province: string;
  ispName: string;
}

interface MobileSegmentRow {
  province: string;
  ispName: string;
}

export async function lookupMobileSegment(mobile: string): Promise<MobileLookupResult> {
  if (!/^\d{11}$/.test(mobile)) {
    throw badRequest('mobile 必须为 11 位手机号');
  }

  const segment = await first<MobileSegmentRow>(db<MobileSegmentRow[]>`
    SELECT
      province_name AS province,
      isp_code AS "ispName"
    FROM product.mobile_segments
    WHERE mobile_prefix = ${mobile.slice(0, 7)}
    LIMIT 1
  `);

  if (!segment) {
    throw notFound('手机号号段不存在');
  }

  return {
    mobile,
    province: segment.province,
    ispName: segment.ispName,
  };
}
