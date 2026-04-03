export interface AdminUser {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  status: string;
  departmentId: string | null;
  mobile: string | null;
  email: string | null;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  roleCode: string;
  roleName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: Pick<AdminUser, 'id' | 'username' | 'displayName' | 'status'> & {
    roleCodes: string[];
  };
}

export interface AdminContext {
  userId: string;
  username: string;
  displayName: string;
  roleCodes: string[];
}

export interface AuditLogRecord {
  id: string;
  operatorUserId: string | null;
  operatorUsername: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  ip: string;
  detailsJson: Record<string, unknown>;
  createdAt: string;
}

export interface LoginLogRecord {
  id: string;
  userId: string | null;
  username: string;
  ip: string;
  deviceSummary: string;
  result: string;
  failureReason: string | null;
  createdAt: string;
}
