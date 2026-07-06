# SeeU Desk MVP v1.0.0 部署检查清单

本文档用于部署前后检查，不面向普通用户展示。

## 1. GitHub 推送状态

- 目标仓库：`https://github.com/Maggie0917/SeeU-Desk.git`
- 主分支：`main`
- 版本 tag：`v1.0.0`
- 推送前确认：
  - [ ] `.env` 未提交。
  - [ ] `.next` 未提交。
  - [ ] `node_modules` 未提交。
  - [ ] `prisma/dev.db` 未提交。
  - [ ] 没有 API Key、App Secret、飞书 token 或用户数据进入 Git。

如果远程仓库不是空仓库，不要强推。先拉取或对比远程差异，再决定合并方案。

## 2. 生产数据库准备

当前生产推荐使用 PostgreSQL。可选方案：

- Neon PostgreSQL
- Supabase PostgreSQL
- Railway PostgreSQL

生产环境变量：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
```

SQLite 只适合本地开发，不适合多人注册使用的线上产品。生产部署前需要执行：

```bash
npx prisma migrate deploy
```

如果还没有 migration 文件，请先在受控环境基于当前 Prisma schema 生成初始 migration，再部署到生产数据库。

## 3. 环境变量配置

生产环境必须配置：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"

AUTH_SECRET="replace-with-strong-random-secret"
APP_ENCRYPTION_SECRET="replace-with-strong-random-secret"

NEXT_PUBLIC_APP_URL="https://your-domain.com"
APP_URL="https://your-domain.com"

FEISHU_APP_ID="cli_xxxxxx"
FEISHU_APP_SECRET="replace-with-feishu-app-secret"
FEISHU_REDIRECT_URI="https://your-domain.com/api/feishu/callback"

OCR_PROVIDER=""
OCR_API_KEY=""
OCR_API_URL=""
```

要求：

- `AUTH_SECRET` 和 `APP_ENCRYPTION_SECRET` 必须是强随机字符串。
- 不能使用示例值上线。
- 不能把 `.env` 提交到 GitHub。
- 当前项目使用自定义认证逻辑，不需要 `NEXTAUTH_SECRET` 或 `NEXTAUTH_URL`。

## 4. 飞书开放平台回调地址配置

本地开发可以使用 localhost callback：

```text
http://localhost:<PORT>/api/feishu/callback
```

正式上线不能使用 localhost。线上必须使用正式域名 callback：

```text
https://你的正式域名/api/feishu/callback
```

飞书后台 Redirect URL 必须和 `FEISHU_REDIRECT_URI` 完全一致：

- 如果使用 Vercel 临时域名，应添加：

```text
https://xxx.vercel.app/api/feishu/callback
```

- 如果后续绑定正式域名，应再添加：

```text
https://正式域名/api/feishu/callback
```

修改飞书后台回调地址后，用户需要从设置页重新连接飞书。

## 5. 飞书权限确认

飞书应用至少需要：

```text
docx:document
docx:document:create
```

检查：

- [ ] 权限已添加。
- [ ] 权限已发布或审批通过。
- [ ] 新用户可以完成授权。
- [ ] 已授权用户在权限变更后已重新授权。
- [ ] 同步失败时不会生成 mock 链接。

## 6. 大模型设置说明

用户可在设置页绑定 OpenAI-compatible 大模型 API。

部署者需要确认：

- [ ] `APP_ENCRYPTION_SECRET` 已配置，用户 API Key 可加密保存。
- [ ] 前端不会明文展示完整 API Key。
- [ ] 服务端日志不会打印完整 API Key。
- [ ] 模型返回 `usage` 时可以记录 Token 消耗。
- [ ] 模型不返回 `usage` 时不伪造 Token 数据。

## 7. OCR 服务配置说明

当前 OCR 用于抖音、小红书等截图兜底导入。

注意：

- 默认 `macos_vision` 方案适合本机 macOS 环境。
- Vercel serverless 环境不适合依赖 macOS Vision 本地能力。
- 生产建议配置云 OCR Provider：

```env
OCR_PROVIDER=""
OCR_API_KEY=""
OCR_API_URL=""
```

OCR 失败时应提示用户重新上传清晰截图或手动粘贴正文。

## 8. Vercel / 其他平台部署步骤

推荐 Vercel 流程：

1. 将 GitHub 仓库连接到 Vercel。
2. 设置 Framework 为 Next.js。
3. 配置生产环境变量。
4. 连接 PostgreSQL 数据库。
5. 首次部署前执行 Prisma migrate deploy。
6. 部署成功后复制 Vercel 域名。
7. 将 `https://xxx.vercel.app/api/feishu/callback` 添加到飞书开放平台 Redirect URL。
8. 回到产品设置页测试飞书授权。
9. 完成线上全流程验收。

如果需要更稳定的后端运行时，或 OCR 依赖服务端长期进程，可考虑 Railway / Render，并同样使用 PostgreSQL。

## 9. 部署后验证清单

- [ ] 可以打开首页 / 登录页。
- [ ] 可以注册新用户。
- [ ] 可以登录。
- [ ] 可以导入公众号文章。
- [ ] 可以导入小红书文章。
- [ ] 抖音截图 OCR 可以生成阅读页。
- [ ] 可以生成文章摘要。
- [ ] 可以生成方法论和启示。
- [ ] 可以生成洞察报告。
- [ ] 可以同步文章到飞书。
- [ ] 可以同步洞察报告到飞书。
- [ ] 可以导出 Markdown / Word / PDF。
- [ ] 数据看板统计正常。
- [ ] 多用户数据隔离正常。
- [ ] 刷新页面数据不丢失。

## 10. 回滚方式

推荐回滚步骤：

1. 在部署平台回滚到上一条成功部署。
2. 如果数据库 migration 已执行，不要直接回滚代码后忽略 schema 差异。
3. 优先使用向前兼容 migration 修复数据库问题。
4. Git 层面可回到稳定 tag：

```bash
git checkout v1.0.0
```

5. 若已推送远程，不要强推覆盖生产分支，使用新的修复提交恢复。
