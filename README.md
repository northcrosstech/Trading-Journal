# Trading Journal

A personal trading journal and wealth tracker.

- **Trading:** Webull trades sync automatically every 15 minutes, with review, journaling, charts and insights.
- **Wealth:** net worth by month, investment portfolios, cash flow, monthly payments, research (fair value and scores) and allocation targets.

Each user signs in separately and sees only their own data. It runs on free tiers.

| Part | Folder | Runs on |
|---|---|---|
| Website (React + Vite) | [`web/`](web/) | Vercel |
| Database, sign-in, storage | [`supabase/migrations/`](supabase/migrations/) | Supabase |
| Sync, pricing and research worker (Python) | [`worker/`](worker/) | Fly.io |

## Documentation

- **[How the app works](docs/GUIDE.md):** using it day to day.
- **[Architecture](docs/ARCHITECTURE.md), [data dictionary](docs/DATA_DICTIONARY.md), [data flows](docs/DATA_FLOWS.md):** working on it.
- **[Deploying the worker](worker/DEPLOY.md).**

## Deploying a change

1. **Database:** run each new file in `supabase/migrations/` in the Supabase SQL editor, oldest first.
2. **Worker:** `fly deploy` from `worker/`.
3. **Website:** push to `main`; Vercel deploys it.

## Local development

- **Website:** in `web/`, add `.env.local` (see [Architecture → Configuration](docs/ARCHITECTURE.md#6-configuration)), then `npm install` and `npm run dev`. Checks: `npx tsc -b`, `npm run lint`, `npm run build`.
- **Worker:** in `worker/`, add `.env`, then `pip install -r requirements.txt` and `python sync.py --once`. Tests: `pytest`.
