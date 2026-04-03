import { forbidden } from '@/lib/errors';
import type { AdminContext } from '@/modules/iam/iam.types';

export function requireAnyAdminRole(
  admin: AdminContext,
  allowedRoles: readonly string[],
): AdminContext {
  if (admin.roleCodes.includes('SUPER_ADMIN')) {
    return admin;
  }

  if (allowedRoles.some((role) => admin.roleCodes.includes(role))) {
    return admin;
  }

  throw forbidden(`当前角色无权访问该后台接口，需要角色: ${allowedRoles.join(', ')}`);
}
