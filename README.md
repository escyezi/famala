# Famala · 兑换码发放平台

React + Vite + Hono + Cloudflare Workers，使用 Drizzle ORM 和 D1。无需注册账号，通过发码 Key 管理独立空间，通过领码 Key 分享兑换码。

每个空间最多 50 个码池（含已停止的码池），每个码池最多 5000 条兑换码（含已领取、已兑换）。单次导入仍最多 500 条；按原始行顺序导入可容纳的有效新码，重复项不占额外容量，超出部分逐行返回容量不足。删除后可释放容量。后端在写入语句内检查容量，防止并发创建或导入突破上限。普通导入每批 30 条，每批的重复项查询与限量写入放在同一 D1 事务内，失败原因按该事务中的状态判断。500 条导入最多执行 37 次 SQL 查询，每条 SQL 最多使用 94 个绑定参数。

## 本地运行

需要 Node.js 24（见 `.nvmrc`）。

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

如果已有 `.dev.vars`，请合并配置，不要直接覆盖。访问 http://127.0.0.1:5173 。`predev` 自动应用本地 D1 迁移，数据保存在 `.wrangler/state/`，刷新或重启不会清空。

`.dev.vars.example` 包含 Cloudflare 官方公开测试密钥，仅用于本地开发。领取仍然调用 Cloudflare 的 Siteverify，因此需要网络访问 `challenges.cloudflare.com`。如果内嵌浏览器的验证组件无法加载，请使用 Chrome 打开本地地址；验证未通过时服务端不会发码。

## 已实现

- 首页发码/领码入口；生成并确认保存发码 Key，已有 Key 登录、退出、切换空间。
- 发码 Key 和会话 Token 仅存 SHA-256 摘要；会话通过 HttpOnly Cookie 保存，固定有效 7 天，HTTPS 下带 Secure，同站严格策略。
- 新建码池支持「创建并导入」连续流程，也可选择「稍后导入」创建空池；名称在当前空间内唯一，导入失败可在已创建的池子中重试。支持修改名称，原领码 Key、链接及领取记录保持有效；本地历史保留领取时保存的名称。
- 支持在详情页确认后永久删除码池。`DELETE /api/manage/pools/:id` 校验空间归属，在同一事务中删除全部兑换码和码池；重复删除返回 404，前端按已删除处理。原领码 Key 与链接失效，同名可重新创建，但 ID 和 Key 不复用。删除不会收回已经发出的兑换码，浏览器保存的历史仍可查看、复制。
- 每次最多导入 500 条，每条最长 100 个 Unicode 码点；去首尾空白、忽略空行、区分大小写。合法行导入，重复/超长行跳过并返回原始行号及原因。
- 管理端集中展示库存统计、导入和分享操作；领码 Key 默认折叠，改名、停止/恢复和删除收在「更多」中。兑换码统一为「待领取、已领取、已兑换」；明细按导入时间倒序，默认每页 20 条，可切换 50 条，并按「全部、待领取、已领取、已兑换」筛选。接口筛选为 `all / unclaimed / claimed / redeemed`，不再接受 `unused / used`；接口未传 `pageSize` 时保持每页 50 条。
- 仅待领取的兑换码支持逐条确认删除，删除语句检查当前状态；已领取或已兑换返回 409。重复删除返回 404，前端按已删除处理。批量删除同样只移除待领取记录，防止与领取或标记兑换并发时误删。
- 「待领取」页签支持逐条勾选、全选当前页及批量确认删除；选择仅属于当前页，翻页、切换筛选/条数或刷新后清空。`DELETE /api/manage/pools/:id/codes` 接收 1–50 个兑换码 ID，以单条语句删除本池中仍待领取的记录，返回删除和跳过数量；已领取、已兑换或不存在的记录自动跳过。
- 领码页的 Turnstile Managed 组件和服务端校验；校验失败、超时或缺少配置均拒绝发码。本期不实现 IP 或其他接口限流。
- 使用单条 SQLite `UPDATE … RETURNING` 原子选码、检查码池状态并记录领取和备注，并发请求不会领到同一个码。
- 本地领取历史与复制兑换码；移除领取者使用标记及 `/api/claim/used`。旧浏览器历史忽略自报使用字段后仍可读取，不同步开发者确认的兑换状态。
- 浏览器本地写入使用 Web Locks 串行合并，同 Key 的另一兑换码不会覆盖已有记录。存储不可用、损坏或浏览器不支持 Web Locks 时，当前页面保留结果并提示复制保存。

本地限领可被清除数据、更换浏览器等方式绕过，不承诺一人一码。服务端已发码但响应丢失时不回收、不提供找回。领取数量统计码的发放数量，不代表人数或实际激活数量。

## 开发者导入已兑换码

详情页「更多」中的「标记已兑换」支持粘贴后直接提交，无预览或二次确认。`POST /api/manage/pools/:id/redeemed/import` 接收 `{ text }`，沿用普通导入的 500 行、每码 100 个 Unicode 码点限制，去首尾空白、忽略空行、区分大小写。仅更新所属码池已有兑换码，不新增记录、不跨池匹配。

返回 `marked`（新增标记）、`alreadyRedeemed`（已标记）、`removedFromAvailable`（本次由待领取转为已兑换的数量）、`failed` 和带原始行号、码内容、原因码的 `failures`。重复、无效、未匹配行跳过，其余有效项在一个 D1 批处理事务中更新，数据库失败整体回滚。重复导入保留首次 `redeemedMarkedAt`；该时间是开发者标记时间，不是实际兑换时间，暂不支持撤销。

状态允许「待领取 → 已领取 → 已兑换」以及「待领取 → 已兑换」。领取和删除只操作待领取码；已兑换后保留原领取时间和备注，没有领取记录的码不补造记录。详情概览包含总量、可领取、累计领取、已确认兑换，其中累计领取按 `claimedAt` 统计，包含后来已兑换的码，与已确认兑换数量可能重叠。明细接口的 `counts` 为互斥状态计数，`summary` 与码池概览采用相同统计口径。

项目尚未上线，现有数据均为可丢弃的测试数据。数据库只保留 `0000_initial.sql` 一次初始化，直接创建最新的三状态结构，不再保留旧字段或数据转换迁移。首次部署时在空数据库上应用初始化，再发布匹配的前后端版本。

## 中英文界面

站点支持简体中文和英文。语言优先使用 `famala.locale` 中保存的手动选择，其次按浏览器语言偏好顺序匹配 `zh-*` / `en-*`，未匹配时使用中文。通过页头语言图标切换，弹窗跟随全站语言；浏览器禁止存储时仍可在当前页面切换。URL 和分享链接不携带语言，领取者按自己的偏好显示。

语言资源位于 `src/react-app/i18n/zh-CN.ts`、`en.ts`，按 common、home、auth、manage、claim、errors 分组，随前端打包。新增界面文案使用语义键、`useTranslation()` 和完整句子插值；带强调或换行的句子使用 `Trans`，数量使用 `count` 与 `_one` / `_other`。英文资源结构受 TypeScript 约束，测试检查两种语言的键、参数和英文复数。用户填写的名称、备注、兑换码与 Key 不翻译。

错误和本地警告保存 `{ code, params?, status? }`，交给 `Notice` 或 `useFormat().message()` 在渲染时翻译，不把已翻译字符串存入状态。API 错误仅返回 `{ code, params? }`，不返回展示文案或内部异常详情；导入失败返回 `{ line, code, reasonCode, params? }`，其中 `code` 是兑换码，不再返回中文 `reason`。共享 `messages.ts` 显式定义错误码、结构化消息和异常，不包含中文文本；新增错误需同步更新错误码类型及两种语言资源，服务端使用 `errorBody()` / `ApiException`。`BusinessError` 与 `ApiError` 使用错误码作为诊断 message，前端忽略响应中的任意 error 文本；未知或缺失错误码显示本地化通用提示。Hono RPC 类型继续由实际路由推导。

日期与数量使用当前语言格式化，时区仍为浏览器本地时区。语言切换不会重建页面或触发业务查询；Turnstile 在切换语言时清空旧 token 并重新验证，领取请求进行中会延迟重建。历史记录格式和 Web Locks 保存规则保持不变，无需迁移数据库或浏览器历史数据。

组件测试固定中文作为初始状态。`I18n.test.tsx` 通过完整 App 的页头 `LanguageToggle` 验证双向切换、偏好保存、元信息更新及英文登录弹窗；弹窗不提供语言按钮。程序化切换仅用于组件响应测试，验证输入与结果保留、错误回退、Turnstile 重建和延迟切换。API 测试主要断言错误码、状态和参数，并验证不再返回 error/reason 展示字段。源码检查递归扫描前端 TS/TSX（含 hooks 和嵌套组件），只排除语言资源及声明文件，仅对语言图标指定 SVG 文本位置的“文”字豁免；它用于发现硬编码中文，资源键、插值和复数另由资源测试验证。运行 `npm run check` 进行完整验证。多语言独立 URL、预渲染和 SEO 不在当前实现范围内。

## 代码格式

使用 Prettier 统一格式，ESLint 负责代码质量检查，并通过 `eslint-config-prettier` 关闭冲突规则。格式约定为 2 空格缩进、单引号、保留分号、行宽 100 和 LF 换行。

```bash
npm run format        # 格式化项目文件
npm run format:check  # 只检查格式，不修改文件
```

VS Code 已配置保存时自动格式化，并推荐 Prettier 和 ESLint 扩展；安装工作区推荐扩展后即可使用。`wrangler.json` 按 JSONC 处理，保留注释。生成的类型、数据库迁移、依赖锁文件、构建产物和本地环境配置通过 `.prettierignore` 排除。

## 验证

```bash
npm run test:components        # 仅组件行为测试，无需启动任何服务
npm run test:components:watch  # 修改组件或测试时自动重跑
npm run test:unit              # 现有 API 和存储测试
npm test                      # 全部测试
npm run lint
npm run build
npm run check
```

`npm run lint` 先运行 `tsc -b`，检查前端、Worker、构建配置和测试的类型，再运行 ESLint。`npm run build` 也保留类型检查，单独构建时仍会验证类型。

类型检查使用 TypeScript 7（`@typescript/native` 是 `typescript` 包的 npm 别名）。ESLint 10 的 `typescript-eslint` 仍依赖旧编译器 API，因此 `typescript` 依赖指向官方 `@typescript/typescript6` 兼容包。两者均为开发依赖；升级时保留这组别名，避免将 ESLint 的 API 依赖直接替换为 TS 7。

`npm test` 使用 Vitest 一次性运行全部测试，`npm run test:watch` 监听修改并重跑。独立的 `vitest.config.ts` 将测试分为两个项目：

- **components**：`tests/components/*.test.tsx`，使用 React Testing Library、user-event 和 jsdom，直接渲染组件并模拟用户操作。无需运行 `npm run dev`、Worker、D1 或浏览器，也不访问 Cloudflare。覆盖登录和 Key 保存确认、领码校验、重复提交防护、验证码过期和重试、备注字数边界、库存状态变化、领取结果持久化与保存失败、旧本地历史兼容与开发者导入兑换标记、复制反馈、码池创建/改名/导入/分页/停止恢复，以及 App 登录、跳转和退出流程。
- **unit**：原有 `tests/*.test.mjs`，在 Node 环境执行，通过 Wrangler 自动创建临时本地 D1，独立于开发库。文件内的测试按顺序执行，单个用例内仍会并发请求以验证导入和领取竞争。Siteverify 使用受控响应，覆盖成功、失败、超时、错误 hostname/action 和生产测试密钥禁用；同时覆盖空间隔离、会话过期/退出、500 条导入边界、并发导入/领取、验证期间停止发放、幂等标记，以及本地记录冲突和存储异常。

### 编写组件测试

新用例放在 `tests/components/` 下，命名为 `*.test.tsx`，按按钮名称或输入框标签查找元素，通过 `userEvent` 操作，再断言可见结果、请求内容或本地记录。使用 `findByRole` / `waitFor` 等待异步状态，不使用固定延时。

`helpers.ts` 的 `mockApi` 按 `方法 + 路径` 显式定义网络响应；组件仍调用真实的 Hono RPC 客户端和 `api()`，未声明的请求会使测试失败。通过 `deferred<Response>()` 控制请求完成时机，可以检查等待状态和防重复提交。Turnstile 仅模拟第三方 SDK，通过 `mockTurnstile().trigger('callback', 'token')` 或 `trigger('expired-callback')` 驱动真实验证组件。

成功响应使用 `satisfies ApiResponses['renamePool']` 等约束；`ApiResponses` 直接从 Hono 路由及成功状态码推导，避免 mock 遗漏字段或使用错误类型。`json()` 保留 `unknown` 入参，以便错误及畸形响应测试刻意构造非法数据。

`setup.ts` 为每个用例清理 DOM、本地存储、路由和 mock，并补齐必要的浏览器 API。Web Locks 模拟只用于单页面保存，不代表真实跨标签并发验证。jsdom 不验证 CSS 布局、原生弹窗焦点管理、浏览器兼容性或真实 Turnstile 服务；这些仍需浏览器检查。测试 TypeScript 类型也纳入了 `npm run build`。

`npm run check` 依次执行格式检查、代码检查、测试、构建和 `wrangler deploy --dry-run`，不会发布。

## 前端状态边界

- `App` 通过 `useSession` 统一管理会话查询、登录结果、退出和过期处理。登录及创建空间直接使用接口返回的会话，导航、刷新码池不再重复查询 session；连接失败可重试。
- 路由只记录路径和查询参数，前进后退同步路由并关闭弹窗。管理页按空间 ID 隔离，码池详情按码池 ID 隔离，领码页按领码 Key 隔离；切换身份或资源时重置对应状态，不再用导航版本号强制重建整页。
- `Manager` 负责选择列表或详情；`PoolList` 管理新建入口，`PoolDetail` 管理分享、明细和详情弹窗，`PoolDialogs` 管理创建、改名和导入表单。`usePools` 负责码池列表请求，`usePoolDetails` 负责明细请求、筛选、分页和操作后的刷新。
- 查询在页面离开或请求替换时取消；已取消请求的结果和 401 通知均被忽略，避免旧请求覆盖新页面或重新打开登录框。导航和会话竞态由 App 组件测试覆盖。

## 前端样式

`index.css` 保留基础元素和表单规则；`App.css` 只作为样式入口，按顺序引入 `styles/` 下的文件：

- `tokens.css`：共用颜色和间距变量。
- `common.css`：页头页脚、按钮、弹窗、提示、空状态和表格等公共样式。表格规则限定在 `.table-scroll` 内。
- `home.css`、`manager.css`、`claims.css`：首页、发码管理和领码/历史记录样式，各自维护对应的响应式规则。

调整现有样式时直接修改所属文件中的规则，避免在入口末尾追加同名覆盖。常用颜色和间距优先复用变量，页面特有的尺寸保留在页面文件中。

## API 类型链路

前后端通过 [Hono RPC](https://hono.dev/docs/guides/rpc) 共享接口类型，无需额外生成客户端：

- `src/worker/index.ts` 链式注册路由并导出 `AppType`。路由返回 `c.json(data, 200)` / `201` 等明确状态码，使客户端可以区分成功与错误响应。
- `src/worker/validation.ts` 在服务端校验 JSON 和查询参数，通过 `c.req.valid()` 向处理函数提供已校验的数据，同时声明 RPC 请求类型。类型检查不能替代对外部请求的运行时校验。
- `src/react-app/api.ts` 使用 `hc<AppType>()`。调用写为 `api(rpc.api.login.$post({ json: { key } }))`，响应类型由路由自动推导；不再通过 `api<T>(path, data)` 指定响应类型。包装层统一保留 Cookie、请求取消、登录过期和网络错误处理，公开页面的会话探测使用 `readSession()`。
- `src/shared/api-types.ts` 从路由推导页面需要的类型；`contracts.ts` 保留本地持久化记录和共享业务规则，相关接口通过 `satisfies` 检查持久化契约。前端仅导入 Worker 的类型，构建时不包含 Worker 实现。
- `tests/types/api.types.ts` 随 `npm run lint` 和 `npm run build` 的 TypeScript 检查执行，验证错误路径、方法、参数、状态枚举和响应字段会被拒绝。它不发出真实请求；API 集成测试另用真实 Hono 路由和临时 D1 验证客户端序列化与服务端校验。

新增接口时保持路由链式注册、添加输入校验、明确响应状态码，再通过 `rpc` 调用。Hono RPC 提供编译期契约，不会逐字段校验服务器返回的 JSON；前后端应一同构建和发布。

## 生产配置

当前 `wrangler.json` 的数据库 ID 为本地占位值，尚未部署。上线前需要：

1. 配置真实 D1 数据库 ID，并应用 `drizzle/` 下的远程迁移。
2. 在 Cloudflare 创建 Managed 模式的 Turnstile Widget，配置实际站点主机名。
3. 设置 Worker 普通变量 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_HOSTNAMES`（逗号分隔，不含协议、端口或路径），保持 `ENVIRONMENT=production`。
4. 用 `wrangler secret put TURNSTILE_SECRET_KEY` 保存 Secret Key。不要将生产 Secret 写入仓库、前端环境变量或日志。
5. 构建后部署到 HTTPS 站点。

生产环境严格校验 `success`、允许的 `hostname`、`action: claim`，拒绝官方测试密钥。官方测试响应可能返回固定 hostname 且没有 action；仅当请求来自 loopback 地址、`ENVIRONMENT=development`、使用官方测试 Secret 且提交官方 dummy Token 时允许测试元数据，仍须 Siteverify 返回成功。

## 文件位置

- 需求：`doc/兑换码发放管理平台.md`
- Worker/API：`src/worker/index.ts`
- 数据表：`src/worker/db/schema.ts`；初始化迁移：`drizzle/0000_initial.sql`
- 前后端共享规则：`src/shared/contracts.ts`
- React 页面：`src/react-app/components/`
- 本地记录：`src/react-app/storage.ts`

项目尚未部署生产，迁移已合并为 `0000_initial.sql`，只创建 4 张业务表，不再包含 `counters`。码池表的 `description` 是可空文本字段，用于保存码池说明，当前仅预留存储字段。所有业务主键使用 `INTEGER PRIMARY KEY AUTOINCREMENT`，外键使用整数；插入时由数据库生成 ID，删除后不复用旧编号，编号可能不连续。API 响应中的 ID 为数字，URL 路径参数仍为字符串，由服务端校验并转换为正安全整数。

初始化迁移仅用于空数据库，不升级旧测试库。需要重新初始化本地测试库时，先停止开发服务，再删除本项目的 `.wrangler/state/v3/d1/` 并运行 `npm run db:migrate`；这会清空本地空间、会话、码池、兑换码及迁移记录。浏览器中的旧领取历史如不再需要，可单独清除 `famala.claimedCodes`。上线前结构变更可继续合并初始化；正式上线后改用增量迁移，不再改写已应用的迁移。

参考：[Turnstile 服务端验证](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)、[官方测试密钥](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)。
