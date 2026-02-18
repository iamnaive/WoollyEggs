# Mouse Reveal (Vite + React + TypeScript)

## Images

Place the two required images here:

- `public/reveal/top.avif`
- `public/reveal/under.avif`

If either image is missing, the app still runs using clear gradient placeholders.

## Run

```bash
npm install
npm run dev
```

## Cursor assets

Put cursor images here:

- `public/cursor/egg_closed.png`
- `public/cursor/egg_open_wl.png`

If they are missing, the app uses generated SVG placeholders.

## Database (Vercel KV)

1. In Vercel dashboard, open your project.
2. Go to **Storage** and create/connect **KV**.
3. Vercel will set KV environment variables automatically.
4. Redeploy the project.
5. The API route `POST /api/monad-address` stores addresses in KV key space `monad:addr:<address>`.

Required env vars for KV:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
