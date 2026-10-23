# EventSync

EventSync is an event management application with a NestJS API, a Prisma/PostgreSQL data model, JWT authentication, organization and event administration, registrations, ticket types, orders, and Stripe Checkout payment processing.

The repository contains two independent npm projects:

| Directory | Stack | Purpose |
| --- | --- | --- |
| `backend/` | NestJS 12, Prisma 7, PostgreSQL 17, TypeScript | REST API, authentication, domain modules, payments and webhooks |
| `frontend/` | Next.js 16 App Router, React 19, Tailwind CSS 4, TypeScript | Web UI starter; API wiring is not implemented yet |

There is no root `package.json` or workspace tooling. Install, start, and test each project from its own directory.

## Architecture

```text
frontend/                         Next.js App Router application
backend/
  prisma/
    schema.prisma                 Database models and enums
    migrations/                   Ordered PostgreSQL migrations
  src/
    auth/                         Registration, sign-in, refresh tokens, JWT guard
    users/                        User CRUD
    organizations/                Organization and membership management
    events/                       Event CRUD and public discovery
    sessions/                     Event sessions and speaker links
    speakers/                     Speaker CRUD
    registrations/                Event registrations
    ticket-types/                 Ticket definitions per event
    orders/                       Order creation and listing
    payments/                     Checkout, mock gateway, Stripe, webhooks
    prisma/                       PrismaService and module
    generated/prisma/             Committed generated Prisma client
  test/                           Jest e2e tests
  docker-compose.yml              Local PostgreSQL 17 service
```

The backend uses Prisma 7 with a generated client committed under `backend/src/generated/prisma/`. The schema datasource intentionally has no `url`; `backend/prisma.config.ts` reads `DATABASE_URL` from the environment via `dotenv/config`.

## Prerequisites

- Node.js 24.x (verified with v24.19.0)
- npm 11.x (verified with v11.17.0)
- Docker with Docker Compose (verified with Docker 29.5.3)
- PostgreSQL 17 (the included Compose service uses `postgres:17`)
- Git
- Stripe CLI only if you want to forward real Stripe test-mode webhooks locally

## Quick start

### 1. Start PostgreSQL

```bash
cd backend
docker compose up -d
```

This starts `eventsync-postgres` on host port `5433` with:

- User: `eventsync`
- Password: `eventsync_password`
- Database: `eventsync`

The credentials above are local development defaults. Do not reuse them in a deployed environment.

### 2. Configure and start the backend

```bash
cd backend
npm install
cp .env.example .env
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

The example configuration starts the API on `http://localhost:4000`. If `PORT` is unset, `backend/src/main.ts` falls back to port `3000`.

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend is currently a Next.js starter page and does not call the API yet.

## Environment variables

The backend reads configuration from `backend/.env`. That file is gitignored. Commit only safe placeholders such as `backend/.env.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by Prisma and the application |
| `PORT` | No | API HTTP port; defaults to `3000` when unset |
| `JWT_SECRET` | Yes | Secret used to sign JWT access and refresh tokens |
| `STRIPE_SECRET_KEY` | No | Stripe test-mode secret key; when absent, checkout uses the mock gateway |
| `STRIPE_CURRENCY` | No | Lowercase ISO 4217 currency for Checkout; defaults to `usd` |
| `STRIPE_SUCCESS_URL` | Required with `STRIPE_SECRET_KEY` | Absolute HTTP(S) URL Stripe returns to after success |
| `STRIPE_CANCEL_URL` | Required with `STRIPE_SECRET_KEY` | Absolute HTTP(S) URL Stripe returns to after cancellation |
| `STRIPE_WEBHOOK_SECRET` | Required for webhooks | Stripe signing secret (`whsec_...`) used to verify webhook signatures |

Example placeholders:

```dotenv
DATABASE_URL="postgresql://eventsync:eventsync_password@localhost:5433/eventsync?schema=public"
PORT=4000
JWT_SECRET="replace-with-a-long-random-development-secret"

# Optional. Omit STRIPE_SECRET_KEY to use the mock checkout gateway.
# STRIPE_SECRET_KEY=sk_test_replace_me
# STRIPE_CURRENCY=usd
# STRIPE_SUCCESS_URL=http://localhost:3000/checkout/success
# STRIPE_CANCEL_URL=http://localhost:3000/checkout/cancel
# STRIPE_WEBHOOK_SECRET=whsec_replace_me
```

Never commit real keys, webhook secrets, passwords, or a populated `.env` file.

## Database and Prisma workflow

Apply all committed migrations:

```bash
cd backend
npx prisma migrate deploy
```

Create a new migration during development:

```bash
npx prisma migrate dev --name describe_the_change
```

After changing `prisma/schema.prisma`, regenerate the committed client:

```bash
npx prisma generate
```

Commit both the schema, the new migration directory, and the regenerated `src/generated/prisma/` files. The generated client is intentionally tracked.

Some early migrations add required columns or replace required columns without defaults. They work on a fresh database but can fail on a database that already contains rows. Review migration warnings before applying them to non-empty data.

## Payments

### Mock mode

If `STRIPE_SECRET_KEY` is not set:

- `POST /orders/:orderId/checkout` uses the in-process mock checkout gateway.
- The returned checkout URL is a mock URL and does not lead to a real payment page.
- The synchronous `POST /orders/:orderId/pay` endpoint currently uses the mock payment gateway regardless of Stripe configuration.
- No external network request is made.

This is the default local development mode and is also used by the test suite.

### Stripe test mode

Set `STRIPE_SECRET_KEY` to a Stripe **test-mode** key and set both redirect URLs. If a key is present but either redirect URL is missing or invalid, the application fails fast at startup.

The hosted Checkout flow is:

1. The client calls `POST /orders/:orderId/checkout` with a bearer access token and an `Idempotency-Key` header.
2. EventSync creates or reuses a payment attempt and asks the checkout gateway for a hosted session.
3. The payment remains `PENDING` and the order remains `PROCESSING`; creating a session does not prove payment.
4. The customer pays on the hosted page and is redirected to `STRIPE_SUCCESS_URL` or `STRIPE_CANCEL_URL`.
5. A signed Stripe webhook confirms the outcome. Only a verified event with `payment_status: paid` marks the payment `SUCCEEDED` and the order `PAID`.

Example checkout request:

```bash
curl -X POST "http://localhost:4000/orders/ORDER_ID/checkout" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Idempotency-Key: unique-client-generated-key"
```

Supported webhook events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

### Webhook verification and idempotency

`POST /payments/webhook/stripe` is unauthenticated by JWT, but it requires a valid `Stripe-Signature` header. Verification uses the exact raw request body and `STRIPE_WEBHOOK_SECRET`. The app enables raw-body capture in `backend/src/main.ts` for this purpose.

Idempotency is enforced at two levels:

- Checkout and pay requests require an `Idempotency-Key` header and reuse the existing payment attempt for the same order and key.
- Each verified Stripe event ID is recorded in `ProcessedWebhookEvent` inside the same transaction that applies the payment and order changes. Duplicate deliveries are acknowledged without repeating side effects.

The webhook also cross-checks currency, amount, metadata order ID, and client reference ID against the persisted payment. A mismatch is ignored and logged rather than applied.

### Payment reconciliation

A verified successful payment may be recorded even when it cannot be applied to its order, for example if the order was cancelled or another attempt already paid it. In that case:

- `Payment.status` becomes `SUCCEEDED`
- `Payment.reconciliationRequired` becomes `true`
- `Payment.reconciliationReason` records a reason such as `LATE_SUCCESS_ORDER_CANCELLED` or `SECOND_SUCCESS_ORDER_ALREADY_PAID`

EventSync does not automatically refund or reconcile these payments. An operator must inspect the flagged payment and resolve it through Stripe and the application's business process.

### Local webhook forwarding

With the backend running on port `4000` and the Stripe CLI installed:

```bash
stripe login
stripe listen --forward-to localhost:4000/payments/webhook/stripe
```

Copy the `whsec_...` signing secret printed by `stripe listen` into `STRIPE_WEBHOOK_SECRET` in `backend/.env`, then restart the backend. Use Stripe test mode only. Do not point local development at live keys or live webhook endpoints.

## Tests and checks

Run commands from the relevant project directory.

### Backend

```bash
cd backend
npm test
npm run test:e2e
npm run lint
npm run build
```

The unit and e2e suites run without real Stripe credentials or live Stripe requests. The webhook e2e test uses an in-memory Prisma stand-in.

### Frontend

```bash
cd frontend
npm run lint
npm run build
```

There is currently no frontend test script.

## Common troubleshooting

### PostgreSQL is not reachable

- Confirm Docker is running: `docker compose ps` from `backend/`.
- Check that host port `5433` is not already in use.
- Confirm `DATABASE_URL` points to port `5433`, not the container's internal `5432`.
- If you need a clean local database and accept losing local data, remove the Compose volume explicitly before starting again. Do not do this against data you need.

### `DATABASE_URL` is missing

Prisma 7 reads the datasource URL from `backend/prisma.config.ts` via `env("DATABASE_URL")`. Create `backend/.env` from `backend/.env.example` or export `DATABASE_URL` before running Prisma commands.

### The backend and frontend both try to use port 3000

The frontend default is `3000`. Set `PORT=4000` in `backend/.env` so the API does not collide with it.

### Startup fails after setting `STRIPE_SECRET_KEY`

`STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` are required whenever a Stripe key is present, and both must be valid absolute HTTP(S) URLs.

### Checkout webhooks return 400

- Confirm `STRIPE_WEBHOOK_SECRET` matches the secret used by the forwarding endpoint.
- Confirm the backend is receiving the raw body. Keep the `rawBody: true` option in `backend/src/main.ts`.
- Confirm the webhook is forwarded to `/payments/webhook/stripe`.

### Webhooks return 503

`STRIPE_WEBHOOK_SECRET` is not configured. Checkout can still create sessions without it, but webhook verification and payment confirmation are unavailable.

### A paid order still has a pending payment

Confirm webhook forwarding is running and that the configured Stripe event types are delivered. Check backend logs for signature failures, unsupported events, unknown session IDs, amount/currency mismatches, or reconciliation flags.

### Generated Prisma client is stale

Run `npx prisma generate` from `backend/` after every schema change, then commit the regenerated files under `backend/src/generated/prisma/`.

### `@nestjs/observe` placeholders

`backend/src/app.module.ts` currently contains placeholder Observe credentials (`YOUR_APP_KEY`, `YOUR_APP_SECRET`). Configure real values or remove the Observe integration before relying on observability in a deployed environment.

## Security notes

- Keep `backend/.env` untracked and never paste real values into issues, logs, or documentation.
- Use Stripe test-mode keys for development and CI.
- Keep webhook signature verification enabled; do not bypass it to make local testing easier.
- Treat `reconciliationRequired` payments as real money movements that need operator review.
- Review migration warnings before applying migrations to a database with existing data.
