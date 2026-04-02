# 《用户与权限服务详细 PRD》

## 1. 文档定位

用户与权限服务负责平台后台内部账号体系，为运营、财务、风控、客服、技术支持提供统一登录、角色授权与审计能力。

V1 只服务平台内部后台，不承载商户、代理、子代理、企业客户的门户账号体系。

## 2. 职责边界

### 2.1 负责内容

- 后台管理员账号管理。
- 登录、登出、Token 刷新。
- 基础角色管理。
- 基础后台访问控制。
- 后台操作审计日志。

### 2.2 不负责内容

- 渠道主体生命周期管理。
- 开放 API 的 `AccessKey / Sign` 鉴权。
- 商户门户、代理门户或外部成员登录。

## 3. V1 角色模型

| 角色 | 典型权限 |
|---|---|
| `SUPER_ADMIN` | 全局配置、敏感操作审批 |
| `OPS` | 商品、渠道、供应商、同步任务、订单异常处理 |
| `FINANCE` | 账户、流水、退款、成本差异查看 |
| `RISK` | 风控规则、黑白名单、拦截日志 |
| `SUPPORT` | 订单查询、回调日志、通知重试、对账差异跟进 |

## 4. 核心对象

| 对象 | 关键字段 |
|---|---|
| AdminUser | `userId`、`username`、`displayName`、`mobile`、`status` |
| Role | `roleCode`、`roleName`、`status` |
| AuditLog | `operatorUserId`、`module`、`action`、`targetId`、`payload`、`createdAt` |

## 5. 核心规则

1. 后台用户与渠道主体完全分离，不允许混用身份。
2. 所有后台写操作必须记录审计日志。
3. 删除用户采用停用，不做物理删除。
4. 敏感操作至少包括：
   - 手工关闭订单
   - 手工重试通知
   - 手工解除供应商熔断
   - 修改供应商凭证
   - 修改渠道余额

## 6. 接口设计

### 6.1 后台 API

- `POST /admin/auth/login`
- `POST /admin/auth/refresh`
- `POST /admin/auth/logout`
- `GET /admin/users`
- `POST /admin/users`
- `GET /admin/roles`
- `POST /admin/roles`

### 6.2 内部能力

- 权限校验中间件。
- 当前用户身份注入。
- 审计日志写入组件。

## 7. 数据设计建议

- `iam.admin_users`
- `iam.roles`
- `iam.user_role_relations`
- `iam.operation_audit_logs`

## 8. 异常与风控要求

- 连续登录失败触发临时锁定。
- Refresh Token 失效后必须强制重新登录。
- 登录日志保留 IP、设备摘要、请求时间。

## 9. 验收标准

1. 后台管理员可登录并刷新会话。
2. 基础角色可区分运营、财务、风控、支持。
3. 所有后台写操作都可追溯到用户和时间。
4. 被停用账号无法继续访问后台接口。

## 10. V1 不做

- 外部门户账号体系。
- 单点登录接入。
- 完整细粒度 RBAC 与复杂数据权限引擎。
