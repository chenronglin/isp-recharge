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
