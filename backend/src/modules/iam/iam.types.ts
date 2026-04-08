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
  user: AdminUserProfile;
}

export interface AdminContext {
  userId: string;
  username: string;
  displayName: string;
  roleCodes: string[];
}

export interface AdminUserProfile {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roleCodes: string[];
}

export interface AdminUserListItem extends AdminUserProfile {
  email: string | null;
  mobile: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDetail extends AdminUserListItem {
  failedLoginAttempts: number;
  lockedUntil: string | null;
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
