import type { AdminContext } from '@/modules/iam/iam.types';

export interface IamContract {
  requireActiveAdmin(userId: string): Promise<AdminContext>;
}
