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

- Netlify + Prisma Postgres Extension
- Neon PostgreSQL
- Supabase PostgreSQL
- Railway PostgreSQL

优先推荐：Netlify + Prisma Postgres 或 Neon PostgreSQL。

如果使用 Prisma Postgres 的 Netlify 扩展，连接后可为部署站点设置 `DATABASE_URL`。上线前仍需确认该变量在 Netlify 生产环境中可被构建和运行时读取。

生产环境变量：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
```

SQLite 只适合本地开发，不适合多人注册使用的线上产品。当前 Prisma provider 已切换为 PostgreSQL，仓库包含 PostgreSQL 初始 migration。生产部署前需要执行：

```bash
npx prisma migrate deploy
```

不要在生产环境长期使用 `prisma db push`。

## 3. 环境变量配置

生产环境必须配置：

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"

AUTH_SECRET="replace-with-strong-random-secret"
APP_ENCRYPTION_SECRET="replace-with-strong-random-secret"

NEXT_PUBLIC_APP_URL="https://your-netlify-site.netlify.app"
APP_URL="https://your-netlify-site.netlify.app"

FEISHU_APP_ID="cli_xxxxxx"
FEISHU_APP_SECRET="replace-with-feishu-app-secret"
FEISHU_REDIRECT_URI="https://your-netlify-site.netlify.app/api/feishu/callback"

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

飞书后台 Redirect URL 必须和 `FEISHU_REDIRECT_URI` 完全一致。如果使用 Netlify 临时域名，应添加：

```text
https://你的-netlify-site.netlify.app/api/feishu/callback
```

- 如果后续绑定正式域名，应再添加：

```text
https://正式域名/api/feishu/callback
```

修改飞书后台回调地址后，用户需要从设置页重新连接飞书。

Netlify 临时域名和正式域名不同。换域名后需要同步修改：

1. Netlify 环境变量 `FEISHU_REDIRECT_URI`。
2. Netlify 环境变量 `NEXT_PUBLIC_APP_URL` / `APP_URL`。
3. 飞书开放平台 Redirect URL。

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
- Netlify serverless 环境不适合依赖 macOS Vision 本地能力。
- 生产建议配置云 OCR Provider：

```env
OCR_PROVIDER=""
OCR_API_KEY=""
OCR_API_URL=""
```

OCR 失败时应提示用户重新上传清晰截图或手动粘贴正文。

如果未配置云 OCR，前端不应显示 mock 成功；应提示“当前未配置 OCR 服务，请手动粘贴正文或联系管理员配置 OCR。”

## 8. Netlify 部署步骤

推荐 Netlify 流程：

1. 登录 Netlify。
2. 选择 New site from Git。
3. 选择 GitHub 仓库 `Maggie0917/SeeU-Desk`。
4. Build command 使用 `npm run build`。
5. Publish directory 让 Netlify 按 Next.js 项目自动识别；不要手动改成普通静态目录。
6. 配置生产环境变量。
7. 连接 PostgreSQL 数据库。
8. 执行 Prisma 生产迁移：

```bash
npx prisma migrate deploy
```

9. 完成首次 Deploy。
10. 获取 Netlify 域名。
11. 将 `https://你的-netlify-域名/api/feishu/callback` 添加到飞书开放平台 Redirect URL。
12. 回到线上产品测试飞书授权。
13. 完成线上全流程验收。

当前项目包含 `netlify.toml`：

```toml
[build]
  command = "npm run build"

[build.environment]
  NODE_VERSION = "20"
```

Netlify 环境变量要在 Netlify 项目后台配置，不要把真实 `.env` 提交到 GitHub。如果变量需要用于构建，作用域必须包含 Builds。

## 8.1 其他平台部署参考

Vercel / Railway / Render 也可部署，但需同样满足：

1. 使用 PostgreSQL。
2. 配置生产环境变量。
3. 执行 `npx prisma migrate deploy`。
4. 配置对应平台域名到飞书 Redirect URL。

如果需要更稳定的后端运行时，或 OCR 依赖服务端长期进程，可考虑 Railway / Render。

## 9. 部署后验证清单

- [ ] 可以打开首页 / 登录页。
- [ ] 可以注册新用户。
- [ ] 可以登录。
- [ ] 可以导入公众号文章。
- [ ] 可以导入小红书文章。
- [ ] 抖音截图 OCR 可以生成阅读页。
- [ ] 可以生成文章摘要。
- [ ] 可以生成方法论和启示。
- [ ] 文章划线生成笔记。
- [ ] 同步文章到飞书。
- [ ] 可以生成洞察报告。
- [ ] 报告红线划线。
- [ ] 写报告随手笔记。
- [ ] 导出 Markdown。
- [ ] 导出 Word。
- [ ] 打印 / 保存 PDF。
- [ ] 同步洞察报告到飞书。
- [ ] 数据看板统计正常。
- [ ] 新建第二个账号，确认看不到第一个账号的数据。
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
