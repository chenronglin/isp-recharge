import { generateId } from '@/lib/id';
import { db } from '@/lib/sql';

export interface AuditInput {
  operatorUserId: string | null;
  operatorUsername: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  requestId: string;
  ip: string;
}

/**
 * 审计日志统一入口。
 * 所有管理后台的敏感写操作都应调用它，避免日志口径不一致。
 */
export async function writeAuditLog(input: AuditInput): Promise<void> {
  await db`
    INSERT INTO iam.operation_audit_logs (
      id,
      operator_user_id,
      operator_username,
      action,
      resource_type,
      resource_id,
      details_json,
      request_id,
      ip,
      created_at
    )
    VALUES (
      ${generateId()},
      ${input.operatorUserId},
      ${input.operatorUsername},
      ${input.action},
      ${input.resourceType},
      ${input.resourceId},
      ${JSON.stringify(input.details)},
      ${input.requestId},
      ${input.ip},
      NOW()
    )
  `;
}
