# 深圳科飞白名单服务器手工联调指引

本文用于白名单服务器上的真实手工联调。本文对应供应商代码 `shenzhen-kefei`，供应商名称 `深圳科飞`，协议类型 `SOHAN_API`。深圳科飞侧需要配置的回调地址示例为 `https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei`。

## 本次联调涉及的接口路径

- `/admin/suppliers/:supplierId/balance`
- `/admin/suppliers/:supplierId/catalog/sync`
- `/open-api/orders`
- `/callbacks/suppliers/shenzhen-kefei`

## 前置条件

1. 已在白名单服务器上部署最新后端，并确认出网 IP 已加入深圳科飞白名单。
2. 已在后端目录执行 `bun run db:seed`。该种子会自动初始化深圳科飞供应商及其基础配置，无需再手工新增供应商。
3. 深圳科飞后台已录入回调地址 `https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei`。
4. 已准备后台管理员 Bearer Token，以及联调用渠道的 `AccessKey`、签名密钥和回调配置。
5. 白名单服务器已安装 Node.js 或 Bun 环境（用于执行签名生成命令，`node -e` / `bun -e` 二选一）。
6. 已拿到深圳科飞在本环境的 `supplierId`。如不确定，可通过下方“查询已种子的 supplierId”命令获取。

## 初始化种子

在后端目录执行：

```bash
cd backend
bun run db:seed
```

预期结果：

1. 命令执行成功，无报错退出。
2. `supplier.suppliers` 中会存在一条 `supplier_code = shenzhen-kefei` 的供应商记录。
3. `supplier.supplier_configs` 中会存在该供应商对应的配置记录，后续可直接用于余额查询、目录同步和真实履约联调。

## 建议先设置环境变量

```bash
export BASE_URL="https://admin.miigo.cn"
export ADMIN_TOKEN="replace-with-admin-bearer-token"
export SUPPLIER_ID="replace-with-shenzhen-kefei-supplier-id"
export ACCESS_KEY="replace-with-open-api-access-key"
export TIMESTAMP="$(date +%s%3N)"
export NONCE="manual-kefei-$(date +%s)"
export CHANNEL_ORDER_NO="manual-kefei-$(date +%Y%m%d%H%M%S)"
```

## 查询已种子的 supplierId

执行命令：

```bash
curl -sS \
  -X GET "$BASE_URL/admin/suppliers" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

预期结果：

1. HTTP 状态码为 `200`。
2. JSON 顶层返回 `code: 0`。
3. 返回数组中存在 `supplierCode = shenzhen-kefei` 的记录。
4. 将该记录的 `id` 填入上方环境变量 `SUPPLIER_ID`。

## 余额查询

执行命令：

```bash
curl -sS \
  -X GET "$BASE_URL/admin/suppliers/$SUPPLIER_ID/balance" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

预期结果：

1. HTTP 状态码为 `200`。
2. JSON 顶层返回 `code: 0`。
3. `data.agentName` 为 `深圳科飞`。
4. `data.agentBalance` 为数字，且不为空。
5. 若深圳科飞侧返回原始状态字段，`data.errorDesc` 应能表示成功。

## 目录同步

执行命令：

```bash
curl -sS \
  -X POST "$BASE_URL/admin/suppliers/$SUPPLIER_ID/catalog/sync" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

预期结果：

1. HTTP 状态码为 `200`。
2. JSON 顶层返回 `code: 0`。
3. `data.supplierCode` 等于 `shenzhen-kefei`。
4. `data.syncedProducts` 为数组。
5. 联调时应优先选择一个“平台中已存在且可售”的业务键做校验，例如 `广东移动 50 元 MIXED`。
6. 如果深圳科飞目录中存在该业务键，`data.syncedProducts` 应返回现有平台商品编码（例如 `cmcc-guangdong-mixed-50`）；至少也要能确认深圳科飞映射已经挂到现有可售商品上，而不是额外新建一条重复平台商品。
7. 当前系统会把深圳科飞目录同步出来的映射按主路由优先级落库（`priority = 0`，`routeType = PRIMARY`），因此对业务键匹配的现有可售商品，开放下单会优先命中深圳科飞。
8. 如果本次同步出的只是全新平台商品，且尚未完成渠道授权、售价配置等可售链路配置，则不要直接继续走开放下单联调。

## 真实话费充值

准备请求体：

```bash
export ORDER_BODY="$(cat <<JSON
{
  \"channelOrderNo\": \"$CHANNEL_ORDER_NO\",
  \"mobile\": \"13800130000\",
  \"faceValue\": 50,
  \"product_type\": \"MIXED\",
  \"ext\": {
    \"scenario\": \"shenzhen-kefei-manual-test\"
  }
}
JSON
)"
```

为本次请求生成真实签名后执行下单。项目签名算法为：先拼接 `METHOD + PATH + TIMESTAMP + NONCE + sha256(body)`（每段以换行 `\n` 连接），再使用渠道 `secret` 做 `HMAC-SHA256`。可直接执行：

```bash
# 任选其一：
# Node.js
export OPENAPI_SIGN="$(CHANNEL_SECRET='replace-with-channel-secret' node -e "const crypto=require('node:crypto');const method='POST';const path='/open-api/orders';const timestamp=process.env.TIMESTAMP||'';const nonce=process.env.NONCE||'';const body=process.env.ORDER_BODY||'';const bodyHash=crypto.createHash('sha256').update(body).digest('hex');const canonical=[method,path,timestamp,nonce,bodyHash].join('\n');process.stdout.write(crypto.createHmac('sha256',process.env.CHANNEL_SECRET||'').update(canonical).digest('hex'));")"

# Bun
export OPENAPI_SIGN="$(CHANNEL_SECRET='replace-with-channel-secret' bun -e "const crypto=require('node:crypto');const method='POST';const path='/open-api/orders';const timestamp=process.env.TIMESTAMP||'';const nonce=process.env.NONCE||'';const body=process.env.ORDER_BODY||'';const bodyHash=crypto.createHash('sha256').update(body).digest('hex');const canonical=[method,path,timestamp,nonce,bodyHash].join('\n');process.stdout.write(crypto.createHmac('sha256',process.env.CHANNEL_SECRET||'').update(canonical).digest('hex'));")"

curl -sS \
  -X POST "$BASE_URL/open-api/orders" \
  -H "Content-Type: application/json" \
  -H "AccessKey: $ACCESS_KEY" \
  -H "Timestamp: $TIMESTAMP" \
  -H "Nonce: $NONCE" \
  -H "Sign: $OPENAPI_SIGN" \
  --data "$ORDER_BODY"
```

预期结果：

1. HTTP 状态码为 `200`。
2. JSON 顶层返回 `code: 0`。
3. 返回体中 `data.orderNo`、`data.matchedProductId` 不为空。
4. `data.mainStatus` 初始为 `CREATED`，表示平台已接单并进入主链路。
5. 该订单的供应商提单应走深圳科飞主路由；若后台查看订单履约明细，首选 supplier candidate 应为 `shenzhen-kefei`。
6. 深圳科飞履约完成后，应向 `https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei` 发起异步回调，平台收到后继续推进订单状态。

## 回调核对

深圳科飞回调目标路径固定为：

```text
https://admin.miigo.cn/callbacks/suppliers/shenzhen-kefei
```

预期结果：

1. 深圳科飞对该路径发起 `POST` 请求。
2. 平台对深圳科飞回调返回纯文本 `OK`。
3. 回调到达后，订单履约状态应继续从 `ACCEPTED` 或 `PROCESSING` 推进到最终状态。
4. 若深圳科飞判定成功，平台订单最终应进入成功态；若深圳科飞返回失败，平台应按既有退款/失败链路处理。

## 可选：让深圳科飞侧回放一笔回调做联调排查

仅在深圳科飞要求确认回调参数格式时使用，不替代真实充值回调。

```bash
curl -i \
  -X POST "$BASE_URL/callbacks/suppliers/shenzhen-kefei" \
  -H "Content-Type: application/x-www-form-urlencoded; charset=utf-8" \
  --data "Action=CX&Orderid=T202603310001&Chargeid=KF202603310001&Orderstatu_int=16&Orderstatu_text=success&Errorcode=0000&Errormsg=ok&Sign=replace-with-kefei-md5-sign"
```

预期结果：

1. HTTP 状态码为 `200`。
2. 响应体为纯文本 `OK`。
3. 如果 `Chargeid` 能匹配到平台已存在的供应商订单，平台会继续做验签、记录回调日志并推进状态。
