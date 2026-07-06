# 部署者上线配置文档

> 本文档仅供产品部署者和维护者查看，不面向普通注册用户展示。请不要把本文档内容放到用户设置页、帮助弹窗或公开使用说明中。

## 1. 飞书开放平台应用配置

上线前需要在飞书开放平台创建并配置一个应用，用于完成用户授权和创建飞书文档。

基本流程：

1. 打开飞书开放平台。
2. 进入开发者后台。
3. 创建企业自建应用或自建应用。
4. 进入应用详情页。
5. 在凭证与基础信息中获取应用凭证。
6. 在安全设置中配置 Redirect URI。
7. 在权限管理中添加新版文档相关权限。
8. 发布应用配置，按飞书后台要求完成管理员审批或版本发布。

需要获取并配置：

```text
App ID
App Secret
```

请妥善保管 `App Secret`，不要提交到 GitHub，不要写入前端代码，不要暴露给普通用户。

## 2. 本地开发 Redirect URI 示例

本地开发时，系统会根据当前 `PORT` 自动生成飞书回调地址：

```text
http://localhost:<PORT>/api/feishu/callback
```

例如本地服务运行在 `PORT=3001` 时，飞书后台应配置同一端口的回调地址。

注意：

1. 协议、域名、端口、路径必须完全一致。
2. 末尾是否有斜杠也要保持一致。
3. 未显式设置 `PORT` 时，系统默认按 `3000` 生成本地回调地址。
4. 修改 `PORT` 或环境变量后需要重启项目。
5. 飞书授权 code 有有效期且只能使用一次，不要复用旧授权链接。

## 3. 线上部署 Redirect URI 示例

线上部署后，需要使用正式域名作为 Redirect URI。

示例：

```text
https://你的正式域名/api/feishu/callback
```

例如：

```text
https://reader.example.com/api/feishu/callback
```

线上环境中的飞书回调地址必须和飞书开放平台后台配置的正式域名回调地址完全一致。生产环境会优先使用 `FEISHU_REDIRECT_URI`，也可从 `DOMAIN`、`NEXT_PUBLIC_APP_URL`、`APP_URL` 或 `VERCEL_URL` 归一化生成。

## 4. 需要配置的环境变量

上线前至少需要配置以下环境变量：

```env
FEISHU_APP_ID="你的飞书 App ID"
FEISHU_APP_SECRET="你的飞书 App Secret"
FEISHU_REDIRECT_URI="https://你的正式域名/api/feishu/callback"
AUTH_SECRET="用于登录态签名的高强度随机字符串"
APP_ENCRYPTION_SECRET="用于加密用户 API Key 等敏感信息的高强度随机字符串"
```

建议：

1. `AUTH_SECRET` 使用至少 32 字节以上的随机字符串。
2. `APP_ENCRYPTION_SECRET` 使用至少 32 字节以上的随机字符串。
3. 不同环境使用不同密钥。
4. 不要把生产环境密钥写入仓库。
5. 不要把生产环境密钥发给普通用户。

## 5. 飞书权限要求

飞书应用需要具备新版文档创建和编辑相关权限。

当前至少需要：

```text
docx:document
docx:document:create
```

用途说明：

```text
docx:document        用于访问、创建或编辑新版飞书文档
docx:document:create 用于创建新版飞书文档
```

如果飞书后台提示需要发布版本、租户管理员审批或权限审核，请按飞书开放平台要求完成。

新增权限后，已经授权过的用户通常需要重新授权，旧 token 不会自动获得新增权限。

## 6. 线上部署后添加正式域名回调地址

线上部署完成后，需要回到飞书开放平台后台添加正式域名回调地址。

检查项：

1. 飞书后台 Redirect URI 已添加正式域名：

```text
https://你的正式域名/api/feishu/callback
```

2. 线上环境的自动生成回调地址或 `FEISHU_REDIRECT_URI` 与飞书后台完全一致。
3. 正式域名已经启用 HTTPS。
4. 线上服务能够访问 `/api/feishu/callback`。
5. 用户点击“连接飞书”后能正常跳转飞书授权页面。
6. 授权成功后能回到产品设置页。
7. token 交换成功后，设置页显示飞书已授权或可调用 API。

## 7. 大模型相关说明

产品支持用户在设置页绑定自己的 OpenAI-compatible 大模型 API。

部署者需要确认：

1. 服务端已配置 `APP_ENCRYPTION_SECRET`，用于加密保存用户 API Key。
2. 前端不会明文展示完整 API Key。
3. 服务端日志不会打印完整 API Key。
4. AI 调用失败时应显示 fallback 提示，不应伪装成真实模型成功。
5. 如果模型返回 `usage` 字段，系统会记录 Token 用量。
6. 如果模型不返回 `usage` 字段，系统只记录不可用状态，不估算或伪造 Token 消耗。

用户常见 OpenAI-compatible 配置示例：

```text
Base URL: https://api.deepseek.com
Model:    deepseek-chat
```

注意：

1. Base URL 应填写模型接口地址，不是网页管理后台地址。
2. 模型名称以对应服务商官方文档或控制台为准。
3. 不同模型服务商的鉴权、余额、速率限制和 usage 返回格式可能不同。

## 8. OCR 相关说明

当前 OCR 能力用于截图导入兜底流程。

部署者需要确认：

1. OCR 上传接口仅处理当前登录用户上传的图片。
2. OCR 失败时不应返回固定 mock 文案。
3. 如果使用本地 OCR，需要确认部署环境支持对应 OCR 运行时。
4. 如果使用外部 OCR Provider，需要配置对应服务的 API Key、API URL 和安全策略。
5. OCR 结果应返回给用户确认和编辑后再生成文章。
6. OCR 失败时应提示用户重新上传清晰截图或手动粘贴正文。

可预留的 OCR 环境变量：

```env
OCR_PROVIDER=""
OCR_API_KEY=""
OCR_API_URL=""
```

如果生产环境不支持本地 OCR，请优先接入稳定的云 OCR 服务，并确保不在日志中打印用户图片内容或隐私信息。

## 9. 上线前检查清单

### 基础服务

- [ ] 生产数据库已配置并完成 schema 同步。
- [ ] `AUTH_SECRET` 已配置为生产级随机密钥。
- [ ] `APP_ENCRYPTION_SECRET` 已配置为生产级随机密钥。
- [ ] 登录、注册、退出流程可用。
- [ ] 多用户数据隔离已验证。

### 飞书

- [ ] 飞书应用已创建。
- [ ] `FEISHU_APP_ID` 已配置。
- [ ] `FEISHU_APP_SECRET` 已配置。
- [ ] 线上飞书回调地址已配置为正式域名回调地址。
- [ ] 飞书后台已添加正式域名 Redirect URI。
- [ ] 飞书应用已申请 `docx:document` 权限。
- [ ] 飞书应用已申请 `docx:document:create` 权限。
- [ ] 飞书应用权限已发布或审批完成。
- [ ] 新用户可以完成飞书授权。
- [ ] 已授权用户可以创建真实飞书文档。
- [ ] 飞书同步失败时不会生成 mock 链接。

### 大模型

- [ ] 用户可以保存自己的 API Key。
- [ ] API Key 不在前端明文展示。
- [ ] API Key 不在服务端日志中明文打印。
- [ ] 测试连接成功和失败都有明确提示。
- [ ] 文章摘要可调用真实模型。
- [ ] 方法论和启示可调用真实模型。
- [ ] 洞察报告可调用真实模型。
- [ ] 无 API 或调用失败时 fallback 提示清楚。
- [ ] Token usage 返回时可被记录。
- [ ] 模型不返回 usage 时不会伪造 Token 数据。

### OCR

- [ ] 上传图片后不会返回固定 mock 文案。
- [ ] OCR 失败时有真实错误提示。
- [ ] OCR 结果可填入正文框并由用户编辑确认。
- [ ] OCR 导入保留原始链接和来源平台。
- [ ] 生产环境 OCR 运行时或外部 Provider 已验证。

### 页面与构建

- [ ] 设置页普通用户帮助说明不展示部署者配置内容。
- [ ] `DEPLOYMENT.md` 不在普通用户页面中展示。
- [ ] `npm run typecheck` 通过。
- [ ] `npm run build` 通过。
- [ ] 生产环境启动后主要页面可访问。
- [ ] 手机端和平板端可正常访问核心页面。
