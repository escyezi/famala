[简体中文](./README.zh-CN.md) | [English](./README.md)

# Famala

Famala 是一个兑换码发放 Web 应用，使用 React、Vite 和 TypeScript 构建。后端采用 Hono，运行于 Cloudflare Workers，通过 Cloudflare D1 和 Drizzle ORM 存储数据，并使用 Cloudflare Turnstile 进行验证。界面支持简体中文和英文。

## 开发

使用 Node.js 24（见 [`.nvmrc`](./.nvmrc)）。

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

如果已有 `.dev.vars`，请合并示例配置，不要直接覆盖。访问 <http://127.0.0.1:5173>。`predev` 脚本会自动应用本地 D1 迁移，本地数据保存在 `.wrangler/state/`，重启后仍会保留。

示例环境文件包含用于本地开发的 Turnstile 公开测试密钥。服务端验证仍需访问 `challenges.cloudflare.com`。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务 |
| `npm run format` | 格式化项目文件 |
| `npm run lint` | 运行 TypeScript 和 ESLint 检查 |
| `npm test` | 运行全部测试 |
| `npm run test:watch` | 监听修改并重跑测试 |
| `npm run test:components` | 运行组件测试 |
| `npm run test:unit` | 运行 API 及其他单元、集成测试 |
| `npm run build` | 检查类型并构建应用 |
| `npm run preview` | 构建并在本地预览 |
| `npm run check` | 检查格式、类型、代码、测试、构建及部署预演 |
| `npm run db:generate` | 生成数据库迁移 |
| `npm run db:migrate` | 应用本地 D1 迁移 |
| `npm run cf-typegen` | 重新生成 Cloudflare 绑定类型 |

`npm run check` 不会发布应用。组件测试使用 jsdom；API 测试使用独立于开发数据的临时本地 D1 数据库。

### 项目结构

```text
src/react-app/   React 界面、样式和翻译资源
src/worker/      Hono API 和数据库结构
src/shared/      共享类型和校验规则
drizzle/        数据库迁移
tests/          组件、API 及其他自动化测试
wrangler.json   Cloudflare Worker、D1 和环境配置
```

数据库结构变更通过新增迁移维护，不改写已应用的迁移。前后端通过 Hono RPC 共享接口类型，应一同构建和部署。

## 部署

部署到 Cloudflare Workers，需要 D1 数据库和 Turnstile Widget。仓库中的 `wrangler.json` 使用占位数据库 ID，生产 Turnstile 配置尚未填写。

1. 登录 Cloudflare；如果尚未创建数据库，执行：

   ```bash
   npx wrangler login
   npx wrangler d1 create famala-db
   ```

2. 将返回的数据库 ID 填入 `wrangler.json`，保留 `DB` 绑定和 `drizzle` 迁移目录。
3. 为部署域名创建 Managed 模式的 Turnstile Widget，并配置以下 Worker 变量：

   | 变量 | 值 |
   | --- | --- |
   | `ENVIRONMENT` | `production` |
   | `TURNSTILE_SITE_KEY` | 生产 Widget 的 Site Key |
   | `TURNSTILE_HOSTNAMES` | 允许的主机名，以逗号分隔，不含协议、端口或路径 |

4. 保存生产密钥：

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

   不要将密钥写入仓库或前端配置。生产环境拒绝公开测试密钥。

5. 验证应用、应用全部待执行的远程迁移并部署：

   ```bash
   npm run check
   npx wrangler d1 migrations apply famala-db --remote
   npm run deploy
   ```

   `npm run check` 已包含生产构建。如果跳过该检查，需先执行 `npm run build`，再执行 `npm run deploy`。远程迁移应在发布对应应用版本前完成；`npm run db:migrate` 只更新本地数据库。

使用 HTTPS，并验证线上应用和 Turnstile 配置。当前每批 500 条的导出性能仍需在独立 Cloudflare 测试部署上验证：使用满量数据，测量 Worker CPU（目标 P95 < 8 ms）、D1 `rows_read`、资源超限错误及移动设备内存占用。如果不达标，将 `EXPORT_BATCH_SIZE` 降至 200，更新分页测试，并在生产发布前重新验证。
