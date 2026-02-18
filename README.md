# Mouse Reveal (Vite + React + TypeScript)

## Images

Place the two required images here:

- `public/reveal/top.jpg`
- `public/reveal/under.jpg`

If either image is missing, the app still runs using clear gradient placeholders.

## Run

```bash
npm install
npm run dev
```

## Database (Vercel Postgres)

1. In Vercel dashboard, open your project.
2. Go to **Storage** and create/connect **Postgres**.
3. Vercel will set Postgres environment variables automatically (including `POSTGRES_URL`).
4. Redeploy the project.
5. The API route `POST /api/monad-address` will create table `monad_addresses` automatically and insert addresses with conflict-safe upsert behavior.
