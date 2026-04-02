# 用户与权限服务模块详细设计

## 模块职责

- 负责后台登录、刷新、登出。
- 管理后台用户、角色、权限、数据权限与审计基础能力。

## 核心表

- `iam.admin_users`
- `iam.roles`
- `iam.permissions`
- `iam.login_sessions`
- `iam.operation_audit_logs`

## 核心接口

- `POST /admin/auth/login`
- `POST /admin/auth/refresh`
- `POST /admin/auth/logout`
- `GET /admin/users`
- `POST /admin/users`
- `GET /admin/roles`
- `POST /admin/roles`

## 关键规则

- 后台鉴权统一使用 JWT Access Token。
- Refresh Token 保存在 `login_sessions` 表，并按哈希值校验。
- 被禁用账号不能访问后台接口。

## 测试重点

- 登录成功与失败。
- Refresh Token 失效处理。
- 被禁用用户访问后台接口时被拦截。
