# EventSync

Monorepo of two **independent** npm projects (no root package.json / workspace tooling). Both app folders run their own install, scripts, and deps — always `workdir` into `frontend/` or `backend/`.

## Repo layout

- `frontend/` — Next.js 16 (App Router, Tailwind v4, TypeScript). Starter app; no API wiring yet.
- `backend/` — NestJS 12 + Prisma 7 + PostgreSQL 17. Starter app; no modules beyond `AppModule`.

## Frontend (Next.js 16) gotchas

- This is **not** the Next.js from your training data — `frontend/AGENTS.md` carries the important, auto-managed notice: read the guide in `frontend/node_modules/next/dist/docs/` before writing Next.js code, and do not delete the `<!-- BEGIN:nextjs-agent-rules -->` block (re-created by `next dev`).
- `frontend/CLAUDE.md` just delegates to `frontend/AGENTS.md`.

## Backend (NestJS + Prisma 7) gotchas

- Prisma 7 uses `prisma.config.ts` (not package.json config). `DATABASE_URL` is read from `.env` via `dotenv/config`; schema `datasource` block has **no** `url` — that's normal for Prisma 7.
- Client is generated into `src/generated/prisma/` via the `prisma-client` generator and its output is **committed**. After any `schema.prisma` change, re-run `npx prisma generate` from `backend/`. `schema.prisma` currently has no models and there are no migrations (`prisma/migrations` does not exist yet).
- Lint is `oxlint` (not eslint): `npm run lint` (`oxlint src/ test/`).
- Tests: `npm run test` (unit, jest), `npm run test:e2e` (jest e2e config).
- Local Postgres: `docker compose up -d` in `backend/` → `eventsync-postgres` exposed on host port **5433** (credentials `eventsync` / `eventsync_password` / db `eventsync`).
- `.env` is gitignored and holds `DATABASE_URL` + `PORT`; a fresh clone must create `backend/.env`.
- `AppModule` wires `@nestjs/observe` with placeholder `YOUR_APP_KEY` / `YOUR_APP_SECRET` and `main.ts` uses its `ObserveInstrument` — replace/remove before relying on runtime behavior.

## Git workflow

- Default branch is `main` (baseline commit); daily work happens on **`develop`**. Both are pushed to GitHub in parallel.