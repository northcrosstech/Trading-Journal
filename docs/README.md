# Documentation

| Document | Read it when you want to… |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | See the whole system: what runs where, how the parts talk, secrets, deploying, limits |
| [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | Look up any table, column, value or database function |
| [DATA_FLOWS.md](DATA_FLOWS.md) | Understand how data gets in, moves between tables, and becomes the numbers on screen |

Other references:
- [`worker/DEPLOY.md`](../worker/DEPLOY.md): Fly.io setup and secrets in detail.
- [`supabase/migrations/`](../supabase/migrations/): the history of every database change. Each file's header comment explains why the change was made.

**Keeping these current:** when a migration adds or changes a table, update
DATA_DICTIONARY.md in the same commit. The diagrams in the other two only need
touching when a new flow or component appears.
