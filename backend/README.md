# EventSync Backend

NestJS 12 REST API for EventSync, using Prisma 7 and PostgreSQL 17.

The backend is an independent npm project. Run all commands in this directory. See the [repository README](../README.md) for the full project overview, payment flow, and shared troubleshooting guide.

## Modules

- `auth`: registration, sign-in, refresh-token sessions, logout, JWT guard
- `users`: user CRUD and current-user lookup
- `organizations`: organizations and membership management
- `events`: event CRUD and public event discovery
- `sessions`: event sessions and session-speaker links
- `speakers`: speaker CRUD
- `registrations`: event registrations and current-user registrations
- `ticket-types`: ticket definitions per event
- `orders`: order creation and listing
- `payments`: mock and Stripe Checkout gateways, payment attempts, Stripe webhooks
- `prisma`: Prisma service and module

## Prerequisites

- Node.js 24.x (verified with v24.19.0)
- npm 11.x (verified with v11.17.0)
- Docker with Docker Compose for the local PostgreSQL container
- PostgreSQL 17
- Stripe CLI only for forwarding real Stripe test-mode webhooks

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL

```bash
docker compose up -d
```

The Compose service is named `postgres` and the container is `eventsync-postgres`. It exposes PostgreSQL on host port `5433`.

Local development defaults:

- User: `eventsync`
- Password: `eventsync_password`
- Database: `eventsync`

These are development-only credentials. Do not reuse them in production.

### 3. Create the environment file

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `backend/.env` with local values. Never commit this file.

### 4. Apply migrations and generate Prisma

```bash
npx prisma migrate deploy
npx prisma generate
```

The generated client lives in `src/generated/prisma/` and is committed to the repository.

### 5. Start the API

```bash
npm run start:dev
```

With `PORT=4000` in `.env`, the API runs at `http://localhost:4000`. If `PORT` is not set, `src/main.ts` falls back to port `3000`.

Other commands:

```bash
npm run start        # start once
npm run start:debug  # debug mode with watch
npm run start:prod   # run compiled output
npm run build        # compile
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string read by `prisma.config.ts` |
| `PORT` | No | API port; defaults to `3000` when unset |
| `JWT_SECRET` | Yes | JWT signing secret |
| `STRIPE_SECRET_KEY` | No | Stripe test-mode secret key; omit to use the mock checkout gateway |
| `STRIPE_CURRENCY` | No | Lowercase ISO 4217 currency; defaults to `usd` |
| `STRIPE_SUCCESS_URL` | Required with `STRIPE_SECRET_KEY` | Absolute HTTP(S) success redirect URL |
| `STRIPE_CANCEL_URL` | Required with `STRIPE_SECRET_KEY` | Absolute HTTP(S) cancel redirect URL |
| `STRIPE_WEBHOOK_SECRET` | Required for webhooks | Stripe webhook signing secret (`whsec_...`) |

Safe example:

```dotenv
DATABASE_URL="postgresql://eventsync:eventsync_password@localhost:5433/eventsync?schema=public"
PORT=4000
JWT_SECRET="replace-with-a-long-random-development-secret"

# Optional Stripe test-mode configuration
# STRIPE_SECRET_KEY=sk_test_replace_me
# STRIPE_CURRENCY=usd
# STRIPE_SUCCESS_URL=http://localhost:3000/checkout/success
# STRIPE_CANCEL_URL=http://localhost:3000/checkout/cancel
# STRIPE_WEBHOOK_SECRET=whsec_replace_me
```

Do not commit `.env` or any real credentials.

## Prisma workflow

The Prisma 7 schema is at `prisma/schema.prisma`. Its datasource has no inline `url`; `prisma.config.ts` loads `DATABASE_URL` through `dotenv/config`.

Common commands:

```bash
npx prisma migrate deploy                          # apply committed migrations
npx prisma migrate dev --name describe_change      # create a development migration
npx prisma generate                                # regenerate the committed client
npx prisma studio                                  # browse the local database
```

After changing the schema:

1. Create and review the migration.
2. Run `npx prisma generate`.
3. Commit the schema, migration directory, and regenerated `src/generated/prisma/` files together.

Some early migrations add required columns or replace required columns without defaults. They apply cleanly to an empty database but can fail on a database with existing rows. Review migration warnings before applying them to non-empty data.

## Testing and checks

```bash
npm test          # Jest unit tests
npm run test:e2e  # Jest e2e tests
npm run lint      # oxlint
npm run build     # Nest build
```

Tests do not require live Stripe credentials and do not send real Stripe requests. The webhook e2e test uses an in-memory Prisma stand-in. Database-backed features still require a correctly configured PostgreSQL instance when exercised outside the test doubles.

## Payments

The API exposes:

- `POST /orders/:orderId/pay` for the synchronous payment path (currently backed by the mock gateway)
- `POST /orders/:orderId/checkout` for hosted checkout
- `POST /payments/webhook/stripe` for Stripe webhook delivery

Both pay and checkout require a JWT and an `Idempotency-Key` header.

If `STRIPE_SECRET_KEY` is unset, checkout uses the in-process mock gateway. If it is set, Stripe Checkout is used and the redirect URLs become required. Payment remains pending until a verified webhook confirms it.

The webhook verifies the `Stripe-Signature` header against the raw request body and `STRIPE_WEBHOOK_SECRET`. Event IDs are recorded in `ProcessedWebhookEvent` in the same transaction as the payment/order updates, making duplicate deliveries safe.

To forward Stripe test-mode webhooks locally:

```bash
stripe listen --forward-to localhost:4000/payments/webhook/stripe
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` and restart the API. Use test-mode keys only.

Payments that cannot be applied to their order are marked `SUCCEEDED` with `reconciliationRequired = true` and a reason. They require manual review and are not refunded automatically. See the [root README](../README.md) for the full payment lifecycle and reconciliation details.

## Troubleshooting

- **Database connection failure**: confirm `docker compose ps` shows `eventsync-postgres` and that `DATABASE_URL` uses host port `5433`.
- **Prisma cannot find `DATABASE_URL`**: create `backend/.env` from `.env.example`.
- **Port collision**: the frontend also uses port `3000`; set `PORT=4000` for the API.
- **Startup fails after adding a Stripe key**: set both `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` to valid absolute URLs.
- **Webhook 400**: verify `STRIPE_WEBHOOK_SECRET`, the `stripe-signature` header, and that raw-body capture remains enabled in `src/main.ts`.
- **Webhook 503**: `STRIPE_WEBHOOK_SECRET` is not configured.
- **Prisma client out of date**: run `npx prisma generate` after schema changes and commit the generated files.
- **Observe placeholders**: `src/app.module.ts` contains `YOUR_APP_KEY` and `YOUR_APP_SECRET`; configure or remove them before relying on observability in a deployment.
