# Documentation

**Start with [GUIDE.md](GUIDE.md)** if you use the app. Read the other three if you work on it.

| Document | Read it when you want to… |
|---|---|
| [GUIDE.md](GUIDE.md) | Use the app: what each page does, the month-end close, portfolio entries, research, allocation, the Health check, what to do when something looks off |
| [ARCHITECTURE.md](ARCHITECTURE.md) | See the whole system: what runs where, how the parts talk, secrets, deploying, limits |
| [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | Look up any table, column, value or database function |
| [DATA_FLOWS.md](DATA_FLOWS.md) | Understand how data gets in, moves between tables, and becomes the numbers on screen |

Other references:
- [`worker/DEPLOY.md`](../worker/DEPLOY.md): Fly.io setup and secrets in detail.
- [`supabase/migrations/`](../supabase/migrations/): the history of every database change. Each file's header comment explains why the change was made.

**Keeping these current:**
- **A migration adds or changes a table:** update DATA_DICTIONARY.md in the same commit.
- **A new page, job, secret or outside service:** update ARCHITECTURE.md.
- **A new flow or calculation:** update DATA_FLOWS.md.
- **Anything a user would notice** (a new page, routine, rule or warning): update GUIDE.md.
