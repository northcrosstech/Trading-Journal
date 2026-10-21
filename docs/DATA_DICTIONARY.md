# Data dictionary

Every table, column and database function in the Supabase database, grouped by what it's
for. Built from the live schema on 2026-10-22 plus the comments in `supabase/migrations/`.

**Related:** [DATA_FLOWS.md](DATA_FLOWS.md) shows how data moves between these tables;
[ARCHITECTURE.md](ARCHITECTURE.md) shows the system around them.

---

## How to read this

**Conventions that apply everywhere**

| Convention | Meaning |
|---|---|
| `user_id` | The owner (Supabase `auth.users.id`). Every user-facing table has one. |
| Row-level security (RLS) | On for every table the app uses: a signed-in user can only read and write rows where `user_id` is their own. The sync worker uses the service-role key, which bypasses RLS. |
| Money | Plain dollars (`numeric`). |
| Option prices | **Per share**, as quoted by brokers (e.g. `4.20`). Multiply by 100 × contracts for dollars. |
| Months | Stored as the first day of the month: `2026-10-01` means October 2026. |
| Trading day | Dates shown in the app are US Central Time (`America/Chicago`). The worker schedules in New York time. |
| `created_at` / `updated_at` | When the row was created / last changed. Not repeated in the tables below. |

**Who writes each table:**
- **App:** the website, as the signed-in user.
- **Worker:** the Fly.io sync worker, using the service-role key.
- **Function:** only through a database function (listed at the end).

**Tables by area**

| Area | Tables |
|---|---|
| [Trading journal](#trading-journal) | `accounts`, `trades`, `executions`, `options_detail` |
| [Review, planning & setups](#review-planning--setups) | `playbooks`, `trade_playbooks`, `daily_plans`, `daily_plan_playbooks`, `daily_journal`, `target_settings` |
| [Net worth](#net-worth) | `networth_accounts`, `networth_balances` |
| [Portfolios](#portfolios) | `portfolios`, `holdings`, `portfolio_activity`, `csp_positions`, `option_positions`, `dividend_info`, `portfolio_daily_values`, `prices` |
| [System](#system) | `sync_log` |
| [Legacy — not used by the app](#legacy--not-used-by-the-app) | `emotions`, `trade_emotions`, `playbook_rule_groups`, `playbook_rules`, `trade_rule_checks`, `daily_rules`, `daily_rule_checks`, `missed_trades`, five `backup_*_20260711` tables |

---

## Trading journal

### `accounts`
A brokerage account trades belong to (Webull, Robinhood, manual…). Accounts are archived or disabled, never deleted. **Written by:** app. **Unique:** `(user_id, label)`.

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | Primary key. Referenced by `trades.account_id`. |
| `broker` | text | `webull` · `schwab` · `manual` · `robinhood`. |
| `label` | text | Display name, e.g. "Webull". |
| `account_type` | text | `live` or `paper`. |
| `sync_mode` | text | `auto` (worker syncs it) or `manual` (manual entry / CSV import). |
| `enabled` | boolean | False pauses syncing. |
| `archived` | boolean | Hidden from default lists. |
| `credential_ref` | text | Reserved for future broker credentials; always null today. |
| `default_asset_type` | text | `stock` or `option` — default for the manual trade form. |
| `per_contract_fee` | numeric | $ per contract/share per fill, to auto-fill fees on manual entry. 0 = don't. |

### `trades`
One **position** from first entry to final exit, built from one or more fills (`executions`). **Written by:** worker (Webull sync, via `upsert_trade_bundle`) and app (manual entry, CSV / Robinhood import, journaling fields). **Unique:** `(user_id, trade_key)` for synced trades; `(user_id, account_id, import_key)` for Robinhood imports.

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | Primary key. |
| `account_id` | uuid | → `accounts.id`. Can't delete an account that has trades. |
| `symbol` | text | Ticker (underlying, for options). |
| `asset_type` | text | `stock` or `option`. |
| `side` | text | `long` or `short`. |
| `status` | text | `OPEN` or `CLOSED`. |
| `avg_entry` / `avg_exit` | numeric | Average fill price in and out (per share; option premium for options). |
| `total_contracts` | numeric | Total quantity opened. |
| `first_in_at` / `last_out_at` | timestamptz | First entry fill / last exit fill. |
| `hold_seconds` | integer | Time from first entry to last exit. |
| `realized_pnl_gross` | numeric | P&L before fees. |
| `realized_pnl_net` | numeric | P&L after fees — what the app shows. |
| `estimated_fee` / `actual_fee` | numeric | Fee estimated instantly from the fee formula / real fee fetched from Webull later. |
| `fee_source` | text | `estimated` until every fill has a real fee, then `actual`. |
| `trade_key` | text | Sync idempotency key: hash of contract + first fill's order id. Null for manual/imported trades. Not account-aware yet — see "Known limitations" in `CLAUDE.md`. |
| `import_key` | text | Robinhood import's own dedup key. Null otherwise. |
| `manually_closed` | boolean | True once you close a trade by hand (e.g. an option that expired worthless). The sync then stops overwriting its outcome fields. |
| `notes` | text | The per-trade journal note. |
| `screenshot_url` | text | Storage path in the `trade-screenshots` bucket (not a public URL). |
| `trade_origin` | text | Whose idea: `planned` · `unplanned` · `followed` (someone else's call). Null = not reviewed. |
| `mistakes` | text[] | ✗ labels from the review checklist (e.g. `FOMO`, `Oversized`). |
| `strengths` | text[] | ✓ labels from the review checklist (e.g. `Waited for Entry`). |
| `stop_price` / `target_price` / `alt_exit_price` | numeric | "What if" prices (per share). Stop defines 1R; target gives planned R; alt exit gives the what-if P&L. |
| `reviewed_at` | timestamptz | Set when the trade passes the review queue with every required section answered. Null = "to review". |
| `thesis_note` / `reflection_note` | text | **Legacy.** Folded into `notes` by the journal revamp; no longer shown. |

### `executions`
Individual fills belonging to a trade. **Written by:** worker and app. **Unique:** `(user_id, client_order_id)`.

| Column | Type | Meaning |
|---|---|---|
| `trade_id` | uuid | → `trades.id` (deleting a trade deletes its fills). |
| `filled_at` | timestamptz | Fill time. |
| `action` | text | `entry` · `add` · `trim` · `exit`. |
| `side` | text | `buy` or `sell`. |
| `price` / `quantity` | numeric | Fill price (per share) and size. |
| `client_order_id` | text | Webull's order id (or a generated id for manual fills). |
| `estimated_fee` / `actual_fee` | numeric | Same as on `trades`, per fill. |

### `options_detail`
One row per **options trade** (one-to-one with `trades`). **Written by:** worker and app.

| Column | Type | Meaning |
|---|---|---|
| `trade_id` | uuid | Primary key and → `trades.id`. |
| `option_type` | text | `call` or `put`. |
| `strike` / `expiration` | numeric / date | Contract terms. |
| `premium` | numeric | Premium per share, when known. |
| `iv_at_entry` / `delta_at_entry` / `theta_at_entry` | numeric | Reserved; not filled today. |
| `assignment_risk` / `assigned` | boolean | Reserved flags; not driven by the app today. |

---

## Review, planning & setups

### `playbooks`
A documented setup ("ORB", "VWAP reclaim") a trade can be tagged with. Shown as **Setups** in Settings. **Written by:** app. **Unique:** `(user_id, name)`.

| Column | Type | Meaning |
|---|---|---|
| `name` / `description` | text | Setup name and notes. |
| `color` / `icon` | text | Chip color and emoji. |
| `market_conditions` / `example_chart_url` | text | Optional notes / example image path (`playbook-assets` bucket). |
| `archived` | boolean | Hidden from pickers; past tags keep working. |

### `trade_playbooks`
Which setup a trade used — **one per trade** (primary key on `trade_id`). **Written by:** app.

| Column | Type | Meaning |
|---|---|---|
| `trade_id` | uuid | → `trades.id`. |
| `playbook_id` | uuid | → `playbooks.id`. |

### `daily_plans`
The pre-market plan for a day. **Written by:** app. **Unique:** `(user_id, plan_date)`.

| Column | Type | Meaning |
|---|---|---|
| `plan_date` | date | The trading day. |
| `plan_notes` | text | Watchlist / plan text. Tickers found here pre-mark trades as Planned in review. |
| `market_read` / `focus` | text | Market read; one focus for the day. |
| `planned_max_trades` / `planned_max_loss` | integer / numeric | That day's limits (max loss defaults from `target_settings`). |

### `daily_plan_playbooks`
Setups planned for a day. Primary key `(daily_plan_id, playbook_id)`. **Written by:** app.

### `daily_journal`
The end-of-day note. **Written by:** app. **Unique:** `(user_id, entry_date)`.

| Column | Type | Meaning |
|---|---|---|
| `entry_date` | date | The day. |
| `notes` | text | Day note. |
| `mood_rating` | integer | Mood picked in the wrap-up (see `web/src/lib/moods.ts`). |

### `target_settings`
Per-user settings — **one row per user** (`user_id` unique). **Written by:** app.

| Column | Type | Meaning |
|---|---|---|
| `loss_limit_value` | numeric | Default max daily loss ($). |
| `profit_target_value` | numeric | Daily profit target ($) — marks green days on the calendar. |
| `profit_target_pct` / `loss_limit_pct` | numeric | Reserved for a future %-of-capital mode; unused. |
| `review_checklist` | jsonb | Your Entry / Size / Stop / TP labels: `{"sections":[{"label":"Entry","good":[…],"bad":[…]},…],"other":[…]}`. Null = default list (`web/src/lib/reviewChecks.ts`). |

---

## Net worth

### `networth_accounts`
An account you track by hand (home, mortgage, checking, credit card…). **Written by:** app.

| Column | Type | Meaning |
|---|---|---|
| `name` | text | Your nickname for it. Never store account numbers. |
| `category` | text | Assets: `home` · `cash` · `401k` · `traditional_ira` · `roth_ira` · `brokerage` · `auto` · `misc_asset`. Debts (subtracted): `mortgage` · `auto_loan` · `credit_card` · `debt` · `other_debt`. |
| `opened_month` | date | First month it appears in the monthly form. |
| `closed_month` | date | From this month on it's gone from the form; history is kept. Null = open. |
| `sort_order` | integer | Display order. |

### `networth_balances`
One balance per account per month. **Written by:** app. **Unique:** `(account_id, month)`.

| Column | Type | Meaning |
|---|---|---|
| `account_id` | uuid | → `networth_accounts.id` (deleting the account deletes its balances). |
| `month` | date | First of the month. |
| `balance` | numeric | **Always positive** — whether it adds or subtracts comes from the account's category. |

> Portfolios tagged Brokerage / 401k / IRA are **not** rows here — net worth reads their month-end value from `portfolio_daily_values`.

---

## Portfolios

### `portfolios`
An investment account you track (separate from the trading journal's `accounts`). **Written by:** app; `cash` changes only through functions.

| Column | Type | Meaning |
|---|---|---|
| `name` | text | e.g. "Long Term". |
| `kind` | text | `brokerage` · `401k` · `traditional_ira` · `roth_ira` — which net-worth line it fills. |
| `cash` | numeric | Cash in the portfolio. Moved by deposits, withdrawals, dividends, buys, sells and options. |
| `archived` | boolean | Archived portfolios aren't priced and leave net worth. |

### `holdings`
Shares currently held. **Written by:** functions (buy/sell/transfer/assignment) and app (Edit corrections). **Unique:** `(portfolio_id, symbol)`.

| Column | Type | Meaning |
|---|---|---|
| `portfolio_id` | uuid | → `portfolios.id`. |
| `symbol` | text | Ticker, uppercase. |
| `quantity` | numeric | Shares (fractional allowed). The row is deleted when it reaches 0. |
| `avg_cost` | numeric | Average cost per share. |
| `manual_price` | numeric | Price to use instead of the daily close — for funds with no public ticker. Null = use `prices`. |

### `portfolio_activity`
Every money/position event — the portfolio's ledger. **Written by:** functions only.

| Column | Type | Meaning |
|---|---|---|
| `occurred_on` | date | The date you entered. |
| `kind` | text | See the table below. |
| `symbol` / `quantity` / `price` | | What and how much (option rows: `quantity` = contracts, `price` = per share). |
| `cash_change` | numeric | Effect on `portfolios.cash` (+ in, − out). |
| `external_flow` | numeric | **Money entering (+) or leaving (−) the portfolio from outside.** This is what time-weighted return excludes. Buys/sells inside the portfolio are 0. |
| `realized_gain` | numeric | Gain/loss locked in by this event, if any. |
| `csp_id` / `option_id` | uuid | → the put / option this row belongs to. |
| `created_at` | timestamptz | When it was recorded — the worker uses this to assign money in/out to the right day. |

**Activity kinds**

| `kind` | Shown as | Cash | External flow | Realized gain |
|---|---|---|---|---|
| `deposit` / `withdrawal` | Deposit / Withdrawal | ± amount | ± amount | — |
| `dividend` | Dividend | + amount | 0 (it's earnings) | — |
| `buy` | Buy | − cost | 0 | — |
| `sell` | Sell | + proceeds | 0 | (price − avg cost) × qty |
| `transfer_in` | Added existing / transfer in | 0 | + value | — |
| `transfer_out` | Moved out | 0 | − value | — |
| `csp_open` | Sold put | + premium | 0 | — |
| `csp_close` / `csp_expire` | Bought back / expired | − buy-back / 0 | 0 | premium kept |
| `csp_assign` | Put assigned | − strike × shares | 0 | — (premium folded into cost basis) |
| `option_buy` / `option_sell` | Bought / sold option | − / + premium | 0 | on sell |
| `option_write` / `option_buyback` | Sold / bought back covered call | + / − premium | 0 | on buyback |
| `option_expire` | Option expired | 0 | 0 | − paid (long) / + kept (short) |
| `option_exercise` | Exercised call | − strike × shares | 0 | — (premium folded into cost basis) |
| `option_assign` | Call assigned | + strike × shares | 0 | strike − avg cost + premium, per share |

### `csp_positions`
Cash-secured puts (sold puts). **Written by:** functions; app sets `mark`.

| Column | Type | Meaning |
|---|---|---|
| `symbol` / `strike` / `expiration` / `contracts` | | Contract terms. |
| `premium` | numeric | Received, per share. |
| `opened_on` / `closed_on` | date | |
| `status` | text | `open` · `expired` · `assigned` · `closed` (bought back). |
| `close_price` | numeric | Buy-back price per share. |
| `mark` | numeric | Your current option price per share. Null = estimate from intrinsic value. |

Cash set aside (collateral) = strike × 100 × contracts — computed, not stored.

### `option_positions`
Long calls/puts (LEAPS, hedges) and covered calls. Sold puts live in `csp_positions`. **Written by:** functions; app sets `mark`.

| Column | Type | Meaning |
|---|---|---|
| `option_type` | text | `call` or `put`. |
| `side` | text | `long` (bought) or `short` (sold covered call — calls only). |
| `strike` / `expiration` / `contracts` | | Contract terms. |
| `open_price` | numeric | Per share: paid (long) or received (short). |
| `status` | text | `open` · `closed` · `expired` · `exercised` (long calls) · `assigned` (covered calls). |
| `close_price` | numeric | Sale / buy-back price per share. |
| `mark` | numeric | Your current option price. Null: long = valued at `open_price`; covered call = max(0, stock − strike). |
| `is_hedge` | boolean | Label only. |

### `dividend_info`
What a ticker pays — entered once per ticker, applies to every portfolio. **Written by:** app. Primary key `(user_id, symbol)`.

| Column | Type | Meaning |
|---|---|---|
| `annual_per_share` | numeric | Yearly dividend per share. |
| `frequency` | text | `monthly` · `quarterly` · `semiannual` · `annual`. |
| `pay_month` | integer | One pay month (1–12); the cycle follows (quarterly + 3 = Mar/Jun/Sep/Dec). Null for monthly. |

Dividends actually **received** are `portfolio_activity` rows with `kind = 'dividend'`.

### `portfolio_daily_values`
Each portfolio's value at each trading day's close — the history behind charts, returns and net worth. **Written by:** worker only (4:45pm ET). Primary key `(portfolio_id, value_date)`.

| Column | Type | Meaning |
|---|---|---|
| `value_date` | date | The trading day. |
| `holdings_value` | numeric | Σ quantity × price. |
| `cash` | numeric | Portfolio cash. |
| `csp_liability` | numeric | Cost to buy back open puts. |
| `options_value` | numeric | Long options' value minus covered calls' buy-back cost. |
| `total_value` | numeric | holdings + cash − csp_liability + options_value. |
| `cost_basis` | numeric | Σ quantity × avg cost. |
| `net_flow` | numeric | Money in/out since the previous day's value (sum of `external_flow`). |
| `computed_at` | timestamptz | When it was written; the next day's `net_flow` counts activity after this. |

### `prices`
Daily closing prices — **shared by all users** (public market data). **Written by:** worker. Readable by any signed-in user. Primary key `(symbol, price_date)`.

| Column | Type | Meaning |
|---|---|---|
| `symbol` / `price_date` | | Ticker and the close's date. |
| `close` | numeric | Closing price (Twelve Data). |
| `fetched_at` | timestamptz | When the worker stored it. |

---

## System

### `sync_log`
One row per Webull sync run — the audit trail, and the source of "Synced 2m ago". **Written by:** worker.

| Column | Type | Meaning |
|---|---|---|
| `ran_at` | timestamptz | Run time. |
| `status` | text | `success` or `error`. |
| `orders_pulled` / `trades_ingested` | integer | Volume. |
| `warnings_count` | integer | Number of warnings. |
| `message` | text | Error, or the first 10 warnings joined by `; ` (e.g. skipped multi-leg orders). |

---

## Database functions

All run as the calling user (so RLS applies) unless marked otherwise. Each one saves completely or not at all.

| Function | Called by | What it does |
|---|---|---|
| `upsert_trade_bundle` | Worker | Writes one trade + its fills + options_detail atomically, deduplicated by `trade_key`. **Security definer.** Skips outcome fields when `manually_closed`. |
| `portfolio_buy` | Buy, Add existing | Adds shares (blends avg cost). Buy takes cash; Add existing records money in. |
| `portfolio_sell` | Sell | Removes shares, adds proceeds to cash, records realized gain. Refuses shares covering open calls. |
| `portfolio_transfer` | Transfer | Moves shares to another portfolio (or out) with avg cost carried over; money out/in on each side. |
| `portfolio_cash` | Cash tab | Deposit / withdrawal / dividend. |
| `csp_open` / `csp_resolve` | Cash-secured puts | Sell a put; resolve as expired / closed / assigned. |
| `option_open` / `option_close` | Options card | Buy call/put or sell covered call; resolve as closed / expired / exercised / assigned. |
| `_own_portfolio` / `_covered_shares` | Other functions | Internal helpers: ownership check; shares promised to open covered calls. |

## Storage buckets

| Bucket | Path | Used for |
|---|---|---|
| `trade-screenshots` (private) | `{user_id}/{trade_id}/{timestamp}-{file}` | Trade screenshots. The app shows them via 1-hour signed URLs. |
| `playbook-assets` (private) | `{user_id}/playbooks/…`, `{user_id}/missed-trades/…` | Setup example charts (missed-trades paths are legacy). |

---

## Legacy — not used by the app

Left over from earlier versions. Nothing in the website or worker reads or writes them.

| Table(s) | Was for | RLS |
|---|---|---|
| `emotions`, `trade_emotions` | Trade psychology chips (replaced by the review checklist) | On |
| `playbook_rule_groups`, `playbook_rules`, `trade_rule_checks` | Per-setup rule checklists | On |
| `daily_rules`, `daily_rule_checks` | Daily discipline checklist | On |
| `missed_trades` | Missed-trade log | On |
| `backup_strategies_20260711`, `backup_trade_strategies_20260711`, `backup_rules_20260711`, `backup_trade_rules_20260711`, `backup_daily_plan_strategies_20260711` | Snapshots taken before the July 2026 playbooks migration | **Off** |

> **⚠ Security:** the five `backup_*` tables have no row-level security, and as of
> 2026-10-22 four of them can be read by **anyone holding the website's public key** — no
> sign-in needed. They hold old strategy/rule names. Nothing references them, so the fix
> is to drop them (Supabase SQL editor):
>
> ```sql
> drop table if exists backup_strategies_20260711, backup_trade_strategies_20260711,
>   backup_rules_20260711, backup_trade_rules_20260711, backup_daily_plan_strategies_20260711;
> ```
>
> The other legacy tables are protected by RLS and harmless to keep. Drop them too if you
> want a cleaner database — nothing depends on them.
