简体中文 | [English](./README.md)

# Famala

Famala 是一个兑换码发放 Web 应用，使用 React、Vite 和 TypeScript 构建。后端采用 Hono，运行于 Cloudflare Workers，通过 Cloudflare D1 和 Drizzle ORM 存储数据，并使用 Cloudflare Turnstile 进行验证。界面支持简体中文和英文。

本项目采用 [MIT 许可证](./LICENSE)。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fescyezi%2Ffamala)

## 开发

使用 Node.js 24（见 [`.nvmrc`](./.nvmrc)）。

```bash
npm ci
cp .env.example .env
npm run dev
```

如果已有 `.env`，请合并示例配置，不要直接覆盖。从旧版升级时，将 `.dev.vars` 的配置迁移到 `.env` 后移除 `.dev.vars`，否则 Wrangler 会优先使用 `.dev.vars`。访问 <http://127.0.0.1:5173>。`predev` 脚本会自动应用本地 D1 迁移，本地数据保存在 `.wrangler/state/`，重启后仍会保留。

唯一的 `.env.example` 已填入可直接使用的本地配置：开发模式、Turnstile 公开测试密钥和本地主机名。本地 D1 模拟 `wrangler.jsonc` 中的 `DB` 绑定，开发时禁用远程绑定。服务端验证仍需访问 `challenges.cloudflare.com`。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务 |
| `npm run format` | 格式化项目文件 |
| `npm run lint` | 检查格式、TypeScript 类型和 ESLint 规则 |
| `npm test` | 运行全部测试 |
| `npm run test:components` | 运行组件测试 |
| `npm run test:unit` | 运行 API 及其他单元、集成测试 |
| `npm run build` | 检查类型并构建应用 |
| `npm run deploy` | 应用远程 D1 迁移并发布已有构建产物 |
| `npm run deploy:maintenance` | 使用已有前端构建发布临时 API 维护入口 |
| `npm run preview` | 构建并在本地预览 |
| `npm run check` | 检查格式、类型、代码、测试、构建及部署预演 |
| `npm run db:generate` | 生成数据库迁移 |
| `npm run db:migrate` | 应用本地 D1 迁移 |
| `npm run db:migrate:remote` | 应用远程 D1 迁移 |
| `npm run db:counters:check -- --local` | 用独立聚合校验持久化计数，不一致时以非零状态退出 |
| `npm run db:counters:rebuild -- --local --writes-paused` | 暂停写入后重建并校验计数 |
| `npm run cf-typegen` | 重新生成 Cloudflare 绑定类型 |

`npm run check` 不会发布应用。组件测试使用 jsdom；API 测试使用独立于开发数据的临时本地 D1 数据库。

### 项目结构

```text
src/react-app/   React 界面、样式和翻译资源
src/worker/      Hono API 和数据库结构
src/shared/      共享类型和校验规则
drizzle/        数据库迁移
tests/          组件、API 及其他自动化测试
wrangler.jsonc   Cloudflare Worker、D1 和环境配置
```

数据库结构变更通过新增迁移维护，不改写已应用的迁移。前后端通过 Hono RPC 共享接口类型，应一同构建和部署。

持久化计数由应用维护，不使用数据库触发器。每次明细写入必须与计数更新放入同一个 `DB.batch()` 事务。使用 `withCounterUpdate` 保持两条语句相邻，确保 SQL `changes()` 指向该次明细写入。直接写入明细的测试数据准备和维护脚本，也必须同步维护计数，或在暂停写入后显式重建。计数校验与重建会扫描现有数据并消耗 D1 额度，应按需显式执行，不定时运行。两种计数命令都要求明确指定 `--local` 或 `--remote` 目标。

## 部署

部署到 Cloudflare Workers，需要 D1 数据库和 Managed 模式的 Turnstile Widget。部署使用 Wrangler 原生命令。公开配置写入 `wrangler.jsonc` 并提交，生产密钥保存在 Cloudflare。数据库 ID、Site Key 和主机名不是访问凭证。

仓库中的公开配置对应 `famala.cc` 及其生产 D1 数据库和 Turnstile Widget。部署自己的实例时，请使用自己的数据库 ID、Site Key 和主机名。

配置显式关闭了 `workers_dev` 和 `preview_urls`。使用自己的自定义域名时，请替换 `routes` 中的主机名。如果改用 `workers.dev` 地址，请移除自定义域名的 `routes`，将 `workers_dev` 设为 `true`，并在 `TURNSTILE_HOSTNAMES` 和 Turnstile Widget 中允许该主机名。修改配置后重新构建再部署。

### 使用部署按钮

上方按钮使用[官方 Deploy to Cloudflare 流程](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。

1. 创建 Managed 模式的 Turnstile Widget，允许计划使用的主机名，例如选定 Worker 对应的 `workers.dev` 主机名或自定义域名。
2. 点击按钮，连接 Cloudflare 和 GitHub/GitLab 账号，选择新仓库和 Worker 的名称。Cloudflare 会创建 D1 数据库，并更新你自己仓库副本中的绑定配置。
3. 填写下表中的生产配置。保持 `ENVIRONMENT=production`，替换页面从 `.env.example` 提供的所有本地测试值。将 `TURNSTILE_SECRET_KEY` 填为 Worker Secret，不要设为构建变量或提交到仓库。
4. 确认构建命令为 `npm run build`，部署命令为 `npm run deploy`。部署命令会先通过 `DB` 绑定应用 D1 迁移，再发布应用，因此自定义数据库名称也能正常迁移。
5. 验证实际部署主机名与 `TURNSTILE_HOSTNAMES`、Turnstile Widget 允许的主机名一致。更换域名时同步更新两处配置。

| 配置 | 生产值 |
| --- | --- |
| `ENVIRONMENT` | `production` |
| `TURNSTILE_SITE_KEY` | 生产 Widget 的 Site Key |
| `TURNSTILE_HOSTNAMES` | 允许的主机名，以逗号分隔，不含协议、端口或路径 |
| `TURNSTILE_SECRET_KEY` | 同一生产 Widget 的 Secret Key，保存为 Cloudflare Worker Secret |

按钮会处理 D1 资源创建，Turnstile Widget 需要单独配置。完成部署后，将公开变量和资源绑定保存在自己仓库的 Wrangler 配置中，确保后续部署使用同一套配置。

### 从自己的本地仓库部署

1. 登录 Cloudflare；如果尚未创建数据库，执行：

   ```bash
   npx wrangler login
   npx wrangler d1 create famala-db --update-config=false
   ```

2. 在 `wrangler.jsonc` 中，将 `database_id` 设为自己数据库的 UUID；如果使用了其他数据库名称，也更新 `database_name`。保留 `DB` 绑定和 `drizzle` 迁移目录，应用通过 `env.DB` 访问数据库。在 `vars` 中填写上表的三个公开生产变量，并按上文配置 Turnstile Widget。
3. 保存生产密钥：

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

4. 检查、构建并部署：

   ```bash
   npm run check
   npm run deploy
   ```

   `npm run check` 包含构建和部署预演，不发布应用或迁移远程数据。`npm run deploy` 应用远程迁移，迁移失败时停止，成功后发布已有的 Vite 构建产物。如果跳过完整检查，请先执行 `npm run build`，再执行 `npm run deploy`。修改 Wrangler 配置后也需要重新构建。`npm run db:migrate` 仍只更新本地数据库。

后续发布可更新本地代码并重复第 4 步。只有更换密钥时才需重新上传 Secret。Wrangler 会自动使用 Vite 构建生成的配置，无需额外的部署配置文件或配置生成脚本。

使用自定义域名时，在 Cloudflare 中进入 Worker 的 **Settings → Domains & Routes → Add → Custom Domain** 添加域名。域名所在区域需要已在同一 Cloudflare 账号中生效。`TURNSTILE_HOSTNAMES` 仅用于验证，不会将域名绑定到 Worker；Turnstile Widget 中也要允许该主机名。

环境变量文件只提交 `.env.example`。`.env` 和旧版 `.dev.vars*` 被 Git 忽略，用于本地开发；部署不会将其内容自动上传为生产密钥。不要将真实密钥写入 `vars`、源码或 `VITE_*` 等前端变量。应用的生产验证会拒绝公开测试密钥。

使用 HTTPS，并验证线上应用和 Turnstile 配置。当前每批 500 条的导出性能仍需在独立 Cloudflare 测试部署上验证：使用满量数据，测量 Worker CPU（目标 P95 < 8 ms）、D1 `rows_read`、资源超限错误及移动设备内存占用。如果不达标，将 `EXPORT_BATCH_SIZE` 降至 200，更新分页测试，并在生产发布前重新验证。
