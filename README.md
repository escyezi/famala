[简体中文](./README.zh-CN.md) | English

# Famala

Famala is a web application for distributing redemption codes, built with React, Vite, and TypeScript. Its Hono API runs on Cloudflare Workers, with Cloudflare D1 and Drizzle ORM for data storage and Cloudflare Turnstile for verification. The interface supports Simplified Chinese and English.

Licensed under the [MIT License](./LICENSE).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fescyezi%2Ffamala)

## Development

Use Node.js 24 (see [`.nvmrc`](./.nvmrc)).

```bash
npm ci
cp .env.example .env
npm run dev
```

If `.env` already exists, merge the example settings instead of overwriting it. When upgrading from `.dev.vars`, move its values into `.env` and remove `.dev.vars`: Wrangler otherwise gives it precedence over `.env`. Open <http://127.0.0.1:5173>. The `predev` script automatically applies local D1 migrations; local data persists in `.wrangler/state/`.

The single `.env.example` contains ready-to-use local values: development mode, public Turnstile test credentials, and loopback hostnames. Local D1 simulates the `DB` binding in `wrangler.jsonc`; remote bindings are disabled during development. Server-side verification still requires network access to `challenges.cloudflare.com`.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run format` | Format project files |
| `npm run lint` | Check formatting, TypeScript types, and ESLint rules |
| `npm test` | Run all tests |
| `npm run test:components` | Run component tests |
| `npm run test:unit` | Run API and other unit/integration tests |
| `npm run build` | Type-check and build the application |
| `npm run deploy` | Apply remote D1 migrations and publish the existing build |
| `npm run deploy:maintenance` | Publish the temporary API maintenance entry point using the existing frontend build |
| `npm run preview` | Build and preview locally |
| `npm run check` | Check formatting, types, lint, tests, build, and deployment dry run |
| `npm run db:generate` | Generate database migrations |
| `npm run db:migrate` | Apply local D1 migrations |
| `npm run db:migrate:remote` | Apply remote D1 migrations |
| `npm run db:counters:check -- --local` | Compare stored counters against an independent aggregate; exit nonzero on mismatch |
| `npm run db:counters:rebuild -- --local --writes-paused` | Rebuild and verify counters after pausing writers |
| `npm run cf-typegen` | Regenerate Cloudflare binding types |

`npm run check` does not publish the application. Component tests use jsdom; API tests use a temporary local D1 database separate from development data.

### Project structure

```text
src/react-app/   React UI, styles, and translations
src/worker/      Hono API and database schema
src/shared/      Shared types and validation rules
drizzle/        Database migrations
tests/          Component, API, and other automated tests
wrangler.jsonc   Cloudflare Worker, D1, and environment configuration
```

Add schema changes as new migrations; do not rewrite migrations that have already been applied. Frontend and API types are shared through Hono RPC, so build and deploy them together.

Stored counters are maintained by the application, without database triggers. Every detail write must execute alongside its counter update in one `DB.batch()` transaction. Use `withCounterUpdate` to keep the statements adjacent: SQL `changes()` must refer to that detail write. Test fixtures and maintenance scripts that write details directly must also maintain the counters or explicitly rebuild them with writers paused. Counter validation and rebuilds scan existing data and consume D1 quota; run them explicitly, not periodically. Both counter commands require an explicit `--local` or `--remote` target.

## Deployment

Deploy to Cloudflare Workers with a D1 database and a Managed Turnstile widget. Deployment uses native Wrangler commands. Commit public configuration in `wrangler.jsonc`; keep production secrets in Cloudflare. Database IDs, site keys, and hostnames are not access credentials.

The checked-in public configuration targets `famala.cc` and its production D1 database and Turnstile widget. For your own deployment, use your own database ID, site key, and hostnames.

`workers_dev` and `preview_urls` are explicitly disabled. For your own custom domain, replace the hostname in `routes`. To use a `workers.dev` address instead, remove the custom-domain `routes`, set `workers_dev` to `true`, and allow that hostname in both `TURNSTILE_HOSTNAMES` and your Turnstile widget. Rebuild before deploying configuration changes.

### Deploy with the button

The button above uses the [official Deploy to Cloudflare flow](https://developers.cloudflare.com/workers/platform/deploy-buttons/).

1. Create a Managed Turnstile widget and allow the hostname you plan to use, such as your chosen Worker hostname under `workers.dev` or your custom domain.
2. Click the button and connect your Cloudflare and GitHub/GitLab accounts. Choose your new repository and Worker names. Cloudflare provisions a D1 database and updates the bindings in your repository copy.
3. Fill in the production values below. Keep `ENVIRONMENT=production` and replace all local test values offered from `.env.example`. Enter `TURNSTILE_SECRET_KEY` as a Worker secret, not as a build variable or a value committed to the repository.
4. Confirm the build command is `npm run build` and the deploy command is `npm run deploy`. The deploy command applies D1 migrations using the `DB` binding before publishing, even if you rename the database.
5. Verify that the actual deployed hostname matches both `TURNSTILE_HOSTNAMES` and the Turnstile widget's allowed hostnames. Update both when changing domains.

| Setting | Production value |
| --- | --- |
| `ENVIRONMENT` | `production` |
| `TURNSTILE_SITE_KEY` | Production widget site key |
| `TURNSTILE_HOSTNAMES` | Allowed hostnames, comma-separated, without protocol, port, or path |
| `TURNSTILE_SECRET_KEY` | Secret key of the same production widget, stored as a Cloudflare Worker secret |

The button handles D1 provisioning; the Turnstile widget must be configured separately. After setup, keep public variables and resource bindings in your repository's Wrangler configuration so later deployments use the same settings.

### Deploy from your own checkout

1. Authenticate and create the database if it does not already exist:

   ```bash
   npx wrangler login
   npx wrangler d1 create famala-db --update-config=false
   ```

2. In `wrangler.jsonc`, set `database_id` to your database's UUID and set `database_name` if you chose a different name. Keep the `DB` binding and `drizzle` migration directory; the application accesses the database as `env.DB`. Set the three public production variables from the table in `vars`; create the Turnstile widget as described above.
3. Store the production secret:

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

4. Check, build, and deploy:

   ```bash
   npm run check
   npm run deploy
   ```

   `npm run check` includes the build and a deployment dry run but does not publish or migrate remote data. `npm run deploy` applies remote migrations, stops if they fail, and publishes the existing Vite build. If skipping the full check, run `npm run build` before `npm run deploy`. Run the build again after changing Wrangler configuration. `npm run db:migrate` remains local-only.

For subsequent releases, update your checkout and repeat step 4. Upload the secret again only when changing it. Wrangler uses the configuration generated by the Vite build automatically; no separate deployment configuration or configuration-generation script is needed.

For a custom domain, add it to the Worker's **Settings → Domains & Routes → Add → Custom Domain** in Cloudflare. The domain's zone must be active in the same Cloudflare account. `TURNSTILE_HOSTNAMES` only controls verification; it does not connect the domain to the Worker. Also allow the hostname in your Turnstile widget.

Only `.env.example` is committed among environment files. `.env` and legacy `.dev.vars*` are ignored and used for local development; deployment does not upload their contents as production secrets. Never place real secrets in `vars`, source code, or frontend variables such as `VITE_*`. The application's production verification rejects public test credentials.

Use HTTPS and verify the deployed application and Turnstile configuration. Export performance at the current 500-record batch size still needs validation on a separate Cloudflare test deployment: test a full dataset, measure Worker CPU (target P95 < 8 ms), D1 `rows_read`, resource-limit errors, and mobile memory usage. If the target is missed, reduce `EXPORT_BATCH_SIZE` to 200, update pagination tests, and validate again before production release.
