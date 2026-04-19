# ISP 话费充值后端

基于 Bun + Elysia 的后端服务，当前基线已经切到新的 V1 模型：

- 数据库是破坏性重置模式，`bun run db:migrate` 会直接重建受管 schema
- 开放接口同时支持两种渠道鉴权
  - 机器对接：`AccessKey + Sign`
  - 门户登录：用户名/密码换取 Bearer Token
- 订单模型已改为 `order_groups(父单) + orders(子履约单)`
- OpenAPI 文档真源为 `GET /openapi/json`，仓库内联调产物为 `api.json`

## 运行要求

- Bun `>= 1.3`
- PostgreSQL `>= 14`

## 环境变量

至少需要下面这些变量。`POSTGRES_HOST` 必须是 `host:port` 格式。

```bash
POSTGRES_HOST=127.0.0.1:5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=isp_recharge

ADMIN_JWT_SECRET=replace-with-admin-secret
INTERNAL_JWT_SECRET=replace-with-internal-secret
APP_ENCRYPTION_KEY=replace-with-stable-32-bytes-key

# 可选
APP_HOST=0.0.0.0
APP_PORT=3000
APP_ENV=development

# 可选：覆盖默认种子账号/凭据
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=Admin123!
SEED_ADMIN_DISPLAY_NAME=平台超级管理员
SEED_CHANNEL_CODE=demo-channel
SEED_CHANNEL_PORTAL_ACCOUNT=demo.portal
SEED_CHANNEL_PORTAL_PASSWORD=Portal123!
SEED_ACCESS_KEY=demo-access-key
SEED_SECRET_KEY=demo-secret-key
SEED_SUPPLIER_CODE=mock-supplier
```

如果你使用 Bun 的自动 `.env` 加载，直接在 `backend/.env` 写上面这组变量即可。

## 初始化

```bash
cd backend
bun install
bun run db:migrate
bun run db:seed
bun run openapi:generate
```

说明：

- `bun run db:migrate` 会重置这些 schema：`iam`、`channel`、`product`、`ordering`、`supplier`、`ledger`、`risk`、`notification`、`worker`
- `bun run db:seed` 会写入演示渠道、后台管理员、mock 供应商、深圳科飞供应商、固定商品目录和基础账务账户
- `bun run openapi:generate` 会根据运行中的路由生成仓库根下的 `backend/api.json`

## 启动服务

开发模式：

```bash
cd backend
bun run dev
```

普通启动：

```bash
cd backend
bun run start
```

启动后默认地址：

- 健康检查：`GET http://localhost:3000/health`
- OpenAPI UI：`GET http://localhost:3000/openapi`
- OpenAPI JSON：`GET http://localhost:3000/openapi/json`

## 常用命令

```bash
cd backend

# 破坏性重建数据库
bun run db:migrate

# 重新注入种子
bun run db:seed

# 生成 OpenAPI 产物
bun run openapi:generate

# 全量测试
bun test

# 单测示例
bun test tests/order-flow-v1.test.ts
bun test tests/order-timeout-v1.test.ts

# TypeScript 类型检查
bunx tsc --noEmit
```

## 预置测试账号与凭据

### 1. 后台管理员

- 登录接口：`POST /admin/auth/login`
- 用户名：`admin`
- 密码：`Admin123!`
- 说明：默认种子用户带 `SUPER_ADMIN`、`OPS`、`FINANCE`、`RISK`、`SUPPORT` 角色

请求体示例：

```json
{
  "username": "admin",
  "password": "Admin123!"
}
```

### 2. 渠道门户账号

- 登录接口：`POST /portal/auth/login`
- 渠道编码：`demo-channel`
- 用户名：`demo.portal`
- 密码：`Portal123!`
- 登录后可用 `Authorization: Bearer <accessToken>` 访问 `/portal/me` 和 `/open-api/*`

请求体示例：

```json
{
  "username": "demo.portal",
  "password": "Portal123!"
}
```

### 3. 渠道机器对接凭据

- 适用接口：`/open-api/channel/*`、`/open-api/products/*`、`/open-api/orders*`
- `AccessKey`: `demo-access-key`
- `SecretKey`: `demo-secret-key`
- 签名算法：`HMAC_SHA256`

请求头字段：

- `AccessKey`
- `Timestamp`
- `Nonce`
- `Sign`

### 4. 默认演示渠道信息

- `channelId`: `seed-channel-demo`
- `channelCode`: `demo-channel`
- `channelName`: `演示渠道`
- 默认 callback：`mock://success`

### 5. 默认供应商测试凭据

这些主要用于联调和测试，不属于后台登录用户。

`mock-supplier`

- `supplierId`: `seed-supplier-mock`
- `supplierCode`: `mock-supplier`
- `accessAccount`: `mock-account`
- `accessPassword`: `mock-password`
- supplier credential：`mock-supplier-token`
- callback secret：`mock-supplier-callback`
- 默认配置：`mock-auto-success`

`shenzhen-kefei`

- `supplierId`: `seed-supplier-shenzhen-kefei`
- `supplierCode`: `shenzhen-kefei`
- `accessAccount`: `JG18948358181`
- `accessPassword`: `sohan-password`
- callback secret：`F29C80BB80EA32D4`
- seed credential JSON：

```json
{
  "agentAccount": "JG18948358181",
  "md5Key": "F29C80BB80EA32D4",
  "baseUrl": "http://api.sohan.hk:50080/API"
}
```

### 6. 仅测试代码内部使用的附加渠道

下面这组不是基础 seed 数据，而是部分集成测试运行时临时插入：

- `channelCode`: `other-channel`
- `AccessKey`: `other-access-key`
- `SecretKey`: `other-secret-key`

## 鉴权说明

后台接口：

- 先 `POST /admin/auth/login`
- 后续使用 `Authorization: Bearer <accessToken>`

渠道门户：

- 先 `POST /portal/auth/login`
- 后续使用 `Authorization: Bearer <accessToken>`

渠道开放接口：

- 可以继续使用 HMAC 机器签名
- 也可以复用门户登录得到的 Bearer Token
- 服务端会从当前认证上下文自动解析渠道，不再接受外部传入 `channelId`

## 测试说明

当前仓库已覆盖并验证的重点测试包括：

- 渠道双鉴权与管理员登录
- 开放下单主链路、退款、通知、超时扫描
- 供应商治理、动态目录同步、深圳科飞协议与回调
- 后台商品维护、渠道充值、账务流水、OpenAPI 文档

最新回归命令：

```bash
cd backend
bunx tsc --noEmit
bun test
```
