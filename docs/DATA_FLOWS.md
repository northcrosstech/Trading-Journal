# Data flows

How data gets into the database, how it moves between tables, and how the numbers on
screen are derived from it. Table and column details are in
[DATA_DICTIONARY.md](DATA_DICTIONARY.md); the systems involved are in
[ARCHITECTURE.md](ARCHITECTURE.md).

**Contents**
1. [How the tables relate](#1-how-the-tables-relate)
2. [Trades coming in](#2-trades-coming-in)
3. [Reviewing a trade](#3-reviewing-a-trade)
4. [Portfolio actions](#4-portfolio-actions)
5. [Daily pricing](#5-daily-pricing)
6. [How the numbers are derived](#6-how-the-numbers-are-derived)
7. [Rules that keep the data consistent](#7-rules-that-keep-the-data-consistent)

---

## 1. How the tables relate

### Trading journal

```mermaid
erDiagram
    accounts ||--o{ trades : "holds"
    trades ||--o{ executions : "built from fills"
    trades ||--o| options_detail : "option terms"
    trades ||--o| trade_playbooks : "tagged with"
    playbooks ||--o{ trade_playbooks : ""
    daily_plans ||--o{ daily_plan_playbooks : "planned setups"
    playbooks ||--o{ daily_plan_playbooks : ""
```

Not linked by keys, but tied by **date** and **user**:
- **`daily_plans` and `daily_journal`** belong to a trading day.
- **A trade's day** is the date of `last_out_at` once closed, or `first_in_at` while open (Central time).
- **`target_settings`** holds one row of per-user settings: limits and the review checklist.
- **`sync_log`** has one row per sync run, per user.

### Wealth (net worth + portfolios)

```mermaid
erDiagram
    networth_accounts ||--o{ networth_balances : "one per month"
    portfolios ||--o{ holdings : "shares"
    portfolios ||--o{ portfolio_activity : "ledger"
    portfolios ||--o{ csp_positions : "sold puts"
    portfolios ||--o{ option_positions : "long calls/puts, covered calls"
    portfolios ||--o{ portfolio_daily_values : "value at each close"
    csp_positions ||--o{ portfolio_activity : "events"
    option_positions ||--o{ portfolio_activity : "events"
    prices }o--o{ holdings : "by symbol"
    dividend_info }o--o{ holdings : "by symbol (per user)"
```

- **`prices` and `dividend_info` join to holdings by `symbol`,** not by a key. `prices` is shared by all users; `dividend_info` is per user.
- **Net worth reads portfolios indirectly:** each active portfolio's latest `portfolio_daily_values` row in a month becomes a line under its `kind`.

---

## 2. Trades coming in

Four ways in, and they never collide: each uses its own deduplication key.

| Path | Writes | Dedup key |
|---|---|---|
| Webull sync (automatic) | `trades`, `executions`, `options_detail` via `upsert_trade_bundle`; `sync_log` | `trades.trade_key`, `executions.client_order_id` |
| Manual entry (`/trades/new`) | `trades`, `executions`, `options_detail` | — (`trade_key` null) |
| CSV import | same as manual | — |
| Robinhood CSV import | same as manual | `trades.import_key` |

### Webull sync

```mermaid
sequenceDiagram
    participant S as Scheduler / Sync now
    participant W as Worker (Fly.io)
    participant WB as Webull OpenAPI
    participant DB as Supabase
    S->>W: every 15 min in market hours, or POST /sync/trigger
    W->>DB: last successful sync_log run
    W->>WB: order history since (last sync date − 2 days), paged
    W->>DB: stored fills of positions still open (so old positions regroup correctly)
    W->>W: normalize orders → fills (skips multi-leg orders) → group into trades
    W->>WB: real fees for a few fills per cycle
    W->>DB: upsert_trade_bundle per trade
    W->>DB: insert sync_log (status, counts, warnings)
```

Things to know:
- **Grouping:** fills group into one trade per contract, from flat to flat. Re-running produces the same `trade_key`, so re-syncs update rows rather than duplicating them.
- **Fees:** each trade gets an **estimated** fee instantly. **Actual** fees are filled in over later cycles, and `fee_source` flips to `actual`.
- **`manually_closed` trades** keep their outcome (status, exit, P&L, hold time) even when the sync runs again. This is for options that expired worthless, because Webull records no order for an expiry.
- **Multi-leg orders** (e.g. strangles) are skipped and logged as a warning in `sync_log.message`.

---

## 3. Reviewing a trade

```mermaid
flowchart LR
    A[Closed trade<br/>reviewed_at = null] --> B[Review queue / trade page]
    B --> C[trade_origin<br/>planned · unplanned · followed]
    B --> D[strengths / mistakes<br/>Entry · Size · Stop · TP · Other]
    B --> E[trade_playbooks<br/>setup]
    B --> F[stop / target / alt exit<br/>notes · screenshot]
    C & D & E --> G{All required<br/>answered?}
    G -- yes, Next --> H[reviewed_at = now]
    G -- no, Next twice --> I[moves on,<br/>stays 'to review']
```

- **Every click saves straight away** to `trades` (and to `trade_playbooks` for the setup). The note saves after a short pause.
- **Which labels each section offers** comes from `target_settings.review_checklist`.
- **The trade rows' Entry / Size / Stop / TP checks** are worked out on the fly from `mistakes` and `strengths`; they aren't stored.

---

## 4. Portfolio actions

Every action is a **database function**, so the holding, the cash and the ledger change together or not at all. The page never edits `cash` directly.

```mermaid
flowchart TB
    subgraph Actions
      buy[Buy] --> f1[portfolio_buy]
      ex[Add existing] --> f1
      sell[Sell] --> f2[portfolio_sell]
      tr[Transfer] --> f3[portfolio_transfer]
      cash[Deposit / Withdraw / Dividend] --> f4[portfolio_cash]
      csp[Sell put / resolve] --> f5[csp_open / csp_resolve]
      opt[Buy call/put, covered call / resolve] --> f6[option_open / option_close]
    end
    f1 & f2 & f3 & f5 & f6 --> H[(holdings)]
    f1 & f2 & f4 & f5 & f6 --> P[(portfolios.cash)]
    f1 & f2 & f3 & f4 & f5 & f6 --> L[(portfolio_activity)]
    f5 --> C[(csp_positions)]
    f6 --> O[(option_positions)]
```

**The one idea to understand:** `portfolio_activity.external_flow` separates **money you add or remove** from **what the investments earn**.

| You do | Cash | `external_flow` | Effect on returns |
|---|---|---|---|
| Deposit $1,000 | +1,000 | +1,000 | none: your money, not a gain |
| Buy shares with it | −1,000 | 0 | none: cash became shares |
| Add existing shares | 0 | + their value | none: your money, not a gain |
| Dividend $20 | +20 | 0 | **counts:** earned |
| Sell at a profit | + proceeds | 0 | **counts:** earned |
| Transfer to another portfolio | 0 | − here, + there | none on either side, nets to 0 combined |

That's why "Add existing" and "Deposit" are the right way to bring in things you already owned. Buy only works when the portfolio has the cash.

---

## 5. Daily pricing

```mermaid
sequenceDiagram
    participant C as Cron 4:45pm ET (trading days)
    participant B as Get prices now button
    participant W as Worker
    participant T as Twelve Data
    participant DB as Supabase
    C->>W: run_pricing(today)
    B->>W: via /api/trigger-sync?job=prices → POST /prices/trigger
    W->>DB: tickers in holdings (no manual price), open puts, open options
    Note over W: button run: only tickers with no price yet
    W->>T: /eod closes, 8 tickers per minute
    W->>DB: upsert prices (symbol, date, close)
    Note over W: button run stops here
    W->>DB: per portfolio: value_portfolio → upsert portfolio_daily_values
```

**How a day's value is calculated** (worker/prices.py `value_portfolio`):

```
holdings_value = Σ quantity × (manual_price, else latest close, else avg cost)
csp_liability  = Σ open puts:   (mark, else max(0, strike − stock)) × 100 × contracts
options_value  = Σ long options: (mark, else price paid) × 100 × contracts
               − Σ covered calls: (mark, else max(0, stock − strike)) × 100 × contracts
total_value    = holdings_value + cash − csp_liability + options_value
net_flow       = Σ external_flow recorded since the previous day's computed_at
```

Prices are **closes**, not live: during market hours the latest close is the previous day's.

---

## 6. How the numbers are derived

Nothing below is stored. The website calculates it from the tables each time a page loads.

| Number | Formula | Code |
|---|---|---|
| Net P&L, win rate, profit factor… | From closed `trades.realized_pnl_net` | `web/src/lib/insights.ts` |
| Position size (Pos) | Peak $ committed, walking the fills | `metrics.ts` `computeCostBasisAnalysis` |
| Return % | net P&L ÷ (avg entry × qty × 100 for options) | `metrics.ts` `returnOnCapitalPct` |
| Oversized ⚠ | Pos ≥ 1.5 × median of your last 30 closed trades (same asset type) | `metrics.ts` `typicalPositionSize` |
| R-multiple | gross P&L ÷ (\|entry − stop\| × qty × multiplier) | `whatIf.ts` |
| Portfolio value (live) | Same as the worker's formula, using the latest stored closes | `portfolio.ts` `portfolioSnapshot` |
| Today's change | Σ quantity × (latest close − previous close) | `portfolio.ts` `holdingView` |
| Time-weighted return | Chain each day's (value − net_flow) ÷ previous value | `portfolio.ts` `timeWeightedReturn` |
| Average per year | (1 + TWR)^(365 ÷ days) − 1, shown only after 365 days | same |
| Allocation / weight | Each position ÷ (shares + long options + positive cash) | portfolio pages |
| Dividend income | annual $/share × shares; per payment = ÷ payments per year | `dividends.ts` |
| Dividend calendar | Past months = recorded `dividend` activity; this month on = expected | `dividends.ts` `dividendCalendar` |
| Net worth (month) | Σ assets − Σ debts for accounts open that month (missing month → last earlier balance, "carried") + each portfolio's last daily value in or before that month | `networth.ts` `monthTotals` |

---

## 7. Rules that keep the data consistent

| Rule | Enforced by |
|---|---|
| Each user only sees their own rows | RLS on every app table |
| A synced trade isn't duplicated on re-sync | `unique (user_id, trade_key)` + `upsert_trade_bundle` |
| A Robinhood re-import is a no-op | `unique (user_id, account_id, import_key)` |
| A manually closed trade stays closed | `manually_closed` checked inside `upsert_trade_bundle` |
| One setup per trade | `trade_playbooks` primary key on `trade_id` |
| One balance per account per month | `unique (account_id, month)` |
| One holding row per ticker per portfolio | `unique (portfolio_id, symbol)` |
| Can't sell more shares than held | `portfolio_sell` / `portfolio_transfer` |
| Can't sell or move shares covering open calls | `_covered_shares` check in sell / transfer / covered call |
| Each covered call needs 100 uncovered shares | `option_open` |
| Cash moves only with a ledger row | all portfolio functions |
| One closing price per ticker per day | `prices` primary key `(symbol, price_date)` |
| One value per portfolio per day | `portfolio_daily_values` primary key `(portfolio_id, value_date)` |
