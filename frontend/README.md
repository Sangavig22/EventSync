# EventSync Frontend

Next.js 16 App Router frontend for EventSync, using React 19, Tailwind CSS 4, and TypeScript.

This is currently a starter interface. It does not call the EventSync API yet and does not define any frontend environment variables. The application lives in `app/` and the entry page is `app/page.tsx`.

See the [repository README](../README.md) for the complete project overview and backend/payment setup.

## Prerequisites

- Node.js 24.x (verified with v24.19.0)
- npm 11.x (verified with v11.17.0)

The frontend is an independent npm project. Run commands from this directory.

## Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The frontend defaults to port `3000`. If you also run the backend locally, set `PORT=4000` in `backend/.env` to avoid a collision.

## Scripts

```bash
npm run dev     # start the development server
npm run build   # create a production build
npm run start   # serve the production build
npm run lint    # run ESLint
```

There is currently no frontend test script.

## API integration status

The backend API is a separate project in `../backend`. When wiring this frontend to it:

- The API does not currently enable CORS in `backend/src/main.ts`, so browser requests from port `3000` to port `4000` will require an explicit CORS configuration or a same-origin proxy.
- Payment and order endpoints require JWT authentication and, for payment/checkout, an `Idempotency-Key` header.
- Stripe Checkout redirects use the backend's `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL`; configure those to match routes you implement in this frontend.

Do not add placeholder environment variables or API URLs until the integration code and configuration actually exist.

## Troubleshooting

- **Port 3000 already in use**: stop the conflicting process, or run the backend on a different port as described above.
- **`next dev` recreates the agent-rules block in `AGENTS.md`**: this is expected behavior for this Next.js version. Do not manually remove the managed block to keep the working tree clean; see the note in `AGENTS.md`.
- **Build or type errors after changing Next.js APIs**: this project uses Next.js 16, which can differ from older documentation. Check the guides under `node_modules/next/dist/docs/` before changing application code.
