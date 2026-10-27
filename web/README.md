# Website

The React + Vite front end, deployed to Vercel on every push to `main`.

```
npm install
npm run dev      # local site, with the /api routes served through Vite
npx tsc -b       # type check
npm run lint     # oxlint
npm run build    # production build
```

- **Environment:** `.env.local` needs the variables listed in [Architecture → Configuration](../docs/ARCHITECTURE.md#6-configuration).
- **Pages:** `src/pages/`. **Data access:** `src/lib/queries.ts` (trading), `src/lib/wealthQueries.ts` (wealth). **Calculations:** `src/lib/`.
- **Serverless functions:** `api/`. Each one must be self-contained; `api/_lib/` holds the copies used in local dev.

How the app works for users: [docs/GUIDE.md](../docs/GUIDE.md).
