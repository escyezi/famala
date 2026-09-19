[简体中文](./README.zh-CN.md) | [English](./README.md)

# Famala

Famala is a web application for distributing redemption codes, built with React, Vite, and TypeScript. Its Hono API runs on Cloudflare Workers, with Cloudflare D1 and Drizzle ORM for data storage and Cloudflare Turnstile for verification. The interface supports Simplified Chinese and English.

## Development

Use Node.js 24 (see [`.nvmrc`](./.nvmrc)).

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

If `.dev.vars` already exists, merge the example settings instead of overwriting it. Open <http://127.0.0.1:5173>. The `predev` script automatically applies local D1 migrations; local data persists in `.wrangler/state/`.

The example environment file contains public Turnstile test credentials for local development. Server-side verification still requires network access to `challenges.cloudflare.com`.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run format` | Format project files |
| `npm run lint` | Run TypeScript and ESLint checks |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:components` | Run component tests |
| `npm run test:unit` | Run API and other unit/integration tests |
| `npm run build` | Type-check and build the application |
| `npm run preview` | Build and preview locally |
| `npm run check` | Check formatting, types, lint, tests, build, and deployment dry run |
| `npm run db:generate` | Generate database migrations |
| `npm run db:migrate` | Apply local D1 migrations |
| `npm run cf-typegen` | Regenerate Cloudflare binding types |

`npm run check` does not publish the application. Component tests use jsdom; API tests use a temporary local D1 database separate from development data.

### Project structure

```text
src/react-app/   React UI, styles, and translations
src/worker/      Hono API and database schema
src/shared/      Shared types and validation rules
drizzle/        Database migrations
tests/          Component, API, and other automated tests
wrangler.json   Cloudflare Worker, D1, and environment configuration
```

Add schema changes as new migrations; do not rewrite migrations that have already been applied. Frontend and API types are shared through Hono RPC, so build and deploy them together.

## Deployment

Deploy to Cloudflare Workers with a D1 database and a Turnstile widget. The checked-in `wrangler.json` contains a placeholder database ID and empty production Turnstile settings.

1. Authenticate with Cloudflare and create the database if it does not already exist:

   ```bash
   npx wrangler login
   npx wrangler d1 create famala-db
   ```

2. Set the returned database ID in `wrangler.json`, keeping the `DB` binding and `drizzle` migration directory.
3. Create a Turnstile widget in Managed mode for your deployment hostname. Configure these Worker variables:

   | Variable | Value |
   | --- | --- |
   | `ENVIRONMENT` | `production` |
   | `TURNSTILE_SITE_KEY` | Production widget site key |
   | `TURNSTILE_HOSTNAMES` | Allowed hostnames, comma-separated, without protocol, port, or path |

4. Store the production secret:

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

   Keep the secret out of the repository and frontend configuration. Public test credentials are rejected in production.

5. Validate the application, apply all pending remote migrations, and deploy:

   ```bash
   npm run check
   npx wrangler d1 migrations apply famala-db --remote
   npm run deploy
   ```

   `npm run check` includes the production build. If deploying without that check, run `npm run build` before `npm run deploy`. Apply remote migrations before deploying the matching application version; `npm run db:migrate` only updates the local database.

Use HTTPS and verify the deployed application and Turnstile configuration. Export performance at the current 500-record batch size still needs validation on a separate Cloudflare test deployment: test a full dataset, measure Worker CPU (target P95 < 8 ms), D1 `rows_read`, resource-limit errors, and mobile memory usage. If the target is missed, reduce `EXPORT_BATCH_SIZE` to 200, update pagination tests, and validate again before production release.
