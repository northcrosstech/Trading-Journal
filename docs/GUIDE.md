# How the app works

A plain-language guide to using the app day to day: what each page does, the routines
that keep the numbers right, and what to do when something looks off. For how it's built,
see [ARCHITECTURE.md](ARCHITECTURE.md).

**Contents**
1. [The two sides](#1-the-two-sides)
2. [Your routines](#2-your-routines)
3. [Trading pages](#3-trading-pages)
4. [Wealth pages](#4-wealth-pages)
5. [Portfolios: how entries work](#5-portfolios-how-entries-work)
6. [Research: fair value and score](#6-research-fair-value-and-score)
7. [Allocation](#7-allocation)
8. [Health check: what each warning means](#8-health-check-what-each-warning-means)
9. [Behind the scenes](#9-behind-the-scenes)
10. [Ground rules](#10-ground-rules)

---

## 1. The two sides

The sidebar switch at the top flips between two separate areas:

| Side | For | Pages |
|---|---|---|
| **Trading** | Day trades: syncing, reviewing and learning from them | Today, Journal, Review, Trades, Insights, Settings |
| **Wealth** | Long-term money: what you own, what you owe, and your investments | Overview, Portfolios, Net worth, Cash flow, Research, Settings |

**The two never mix.** Day-trading results don't feed into portfolios or net worth, so a
good or bad trading week never distorts your long-term picture.

Each person signs in with their own login and only ever sees their own data.

---

## 2. Your routines

| When | What | Where |
|---|---|---|
| **Every trading day** | Nothing to do. Trades sync every 15 minutes in market hours; prices and research update at 4:45 PM New York time | Automatic |
| **After trading** | Review closed trades: whose idea it was, what went well or badly, the setup | Review |
| **When you buy, sell or move money** in a portfolio | Record it as an entry so cash and shares stay right | Portfolio page → actions |
| **Start of each month** (by the 5th) | **Close last month:** enter each account's balance as of the last day, and mark payments paid | The amber "Close {month}" banner |
| **Now and then** | Glance at the Health check and the Allocation card | Portfolios |

### Closing a month

Net worth is built from month-end balances, so each month needs closing once it's over.

- **From the 1st,** an amber banner appears: *"Close October · 5 of 8 balances updated"*. It lists what's missing.
- **Use the balance on the last day of the month** from each statement. Debts are entered as positive numbers; the app subtracts them.
- **Mark each payment paid** under Monthly payments.
- **When everything is in,** the banner disappears.

**Which month Net worth opens on:**
- **From the 6th to the end of the month,** it opens on the current month.
- **On the 1st–5th,** it stays on last month until you close it.
- **After the 5th,** an unclosed month keeps its banner, with an **Open** button.

**Missing a balance isn't fatal.** A month without one uses the last balance you entered,
marked "carried", until you fill it in.

### Monthly payments

| Debt | Set up with | What's due |
|---|---|---|
| Mortgage, auto loan, personal loan | Payment amount + due day | That amount, on that day each month |
| Credit card | Due day only | The month's closing balance, due on that day **next month** (October's statement is paid in November). A $0 card has nothing due |
| Mortgage with escrow | Also the escrow amount | The full payment is due; the payoff estimate uses only the part that pays the loan |

Marking a payment paid doesn't change any balance. Balances always come from your statements.

---

## 3. Trading pages

| Page | What it's for |
|---|---|
| **Today** | Pre-market plan, live risk against your daily loss limit, today's trades |
| **Journal** | Calendar of days with P&L; a card per day with notes and mood |
| **Review** | One closed trade at a time: whose idea it was (planned / unplanned / followed), what went well, what went wrong, the setup. A trade leaves the queue once every required part is answered |
| **Trades** | The full log and each trade's page: fills, chart with entry and exit markers, notes, screenshot, "what if" prices |
| **Insights** | Win rate, profit factor, and breakdowns by setup, time, mistakes and more |
| **Settings** | Daily loss limit and profit target, your setups, your review checklist labels |

**Trades get in four ways:** the Webull sync (automatic), manual entry, CSV import and Robinhood CSV import.

Things to know about synced trades:
- **Multi-leg Webull orders** (strangles, spreads) are skipped; enter them by hand.
- **An option that expired worthless** has no closing order at Webull. Close it by hand on its trade page. Once you do, the sync stops changing it.

---

## 4. Wealth pages

| Page | What it shows |
|---|---|
| **Overview** | Net worth and its change from last month, investments, dividend income, a month-by-month chart, allocation, where your net worth is, and each portfolio. The close banner shows here too |
| **Net worth** | Everything you own minus everything you owe, by month. Accounts, monthly balances, a yearly chart, what's in each category, and Monthly payments |
| **Cash flow** | What you kept each month, worked out from balances alone (no income entry): cash saved + invested + debt paid down, reconciled to the change in net worth |
| **Portfolios** | Each portfolio's value and day change, the Health check, and Allocation |
| **Portfolio page** | Holdings, Activity, options, sold puts, dividends, performance, and that portfolio's own mix |
| **Research** | Fair value, score and next earnings date for everything you hold, plus a watchlist |

### How investments reach net worth

- **Portfolio-linked lines:** each portfolio's value on the last trading day of the month fills its line (Brokerage, 401k, Traditional IRA or Roth IRA) automatically.
- **Margin:** a portfolio with negative cash (margin used) shows that as a separate **Margin loans** debt.
- **Everything else** (home, cash, cards, loans) is a balance you enter.

---

## 5. Portfolios: how entries work

**The one rule:** shares, average cost and cash change **only through entries** (Activity).
The holding's pencil edits only a manual price. That's what keeps every number traceable.

| You did | Use | Effect on returns |
|---|---|---|
| Put money in / took money out | **Cash → Deposit / Withdraw** | None: it's your money, not a gain |
| Bought shares | **Click the position** (or Trade → Buy) | None: cash became shares |
| Already owned shares before using the app | **Add existing** | None: counted as money in |
| Sold shares | **Click the position** (or Trade → Sell) | The gain or loss counts |
| Got a dividend | **Cash → Dividend** | Counts as earnings |
| Moved shares between portfolios | **Transfer** | None on either side |
| Stock split (or reverse split) | **Split** | None: shares × ratio, cost ÷ ratio |
| Broker's cash differs, or you're on margin | **Set balance** (negative for margin) | None as a correction; ticked as interest or fees it lowers returns |
| Options and sold puts | The **Options** and **Cash-secured puts** cards | Premiums and closes count |

**Option prices are per share,** as brokers quote them (e.g. 4.20). The app multiplies by 100 × contracts.

### Logging buys and sells from your positions

The quickest way to record trades:

1. **Click a position.** A form opens under it with the ticker, today's date and the last price filled in.
2. **Pick Bought or Sold** and type the shares. **All** fills in your whole position for a sale. Change the price to your fill price, and add the fee if there was one.
3. **More than one trade?** Press **Add another** for a new line (any ticker, bought or sold). For a ticker you don't hold yet, use **New ticker** above the table.
4. **Check the cash before → after** at the bottom against your broker, then press **Log**.

Every line is saved together, or none are: if one line has a problem (e.g. selling more than you hold), nothing is saved and that line is marked. Each line still becomes its own Activity entry, so you can edit or undo any one later.

**Fees** count: on a buy they're added to your cost (so average cost includes them, like your broker's), on a sale they come off what you receive. The Activity list shows the fill price and the fee.

**Behind on logging?** Each portfolio shows **Last entry** with a date, on its card and above its holdings, so you know where to pick up.

### Fixing a mistake

- **Edit** an entry to correct it, or **Undo** to reverse it. Nothing is deleted: the original stays as history ("Show undone or edited entries").
- **Undo newest first for a ticker.** An entry that changed a holding can only be undone while it's the newest entry for that ticker in that portfolio.
- **Options and puts** have their own Edit and Undo. Undo reopens a closed one, or removes an open one.
- **Transfers can't be undone;** transfer the shares back instead.

### Returns

**Return % is time-weighted:** it measures how the investments did, ignoring when you added
or removed money. "Average per year" appears once a portfolio has a year of history.

---

## 6. Research: fair value and score

Every held or watchlisted company gets a **fair value** and a **score out of 100**. Click
either one for the full breakdown and "How this is calculated".

**Fair value** (Graham's revised formula):

> EPS × (7 + growth) × 4.4 ÷ today's AAA corporate bond yield

- **EPS** is earnings per share over the last 12 months. For a company that reports in another currency (TSM reports in Taiwan dollars), it's worked out as price ÷ P/E so it's in dollars per share you hold.
- **Growth** is what analysts expect earnings to grow per year, from next fiscal year to up to 5 years out. Without a forecast (smaller companies, or no estimates yet), it falls back to the lower of the past 5-year and 3-year growth. Either way it's capped at 30% (you can change the cap), and negative growth counts as 0. The breakdown says which one was used.
- **Higher bond yields mean lower fair values.** Money is worth more elsewhere.
- **Reading it:** under 85% of fair value is *cheap*, 85–105% *fair*, 105–130% *pricey*, over 130% *expensive*. "Buy below" is 85% of fair value.

**Score:**

| Part | Points | Measures |
|---|---|---|
| Valuation | 20 | Price compared with fair value |
| Growth | 20 | Earnings growth per year |
| Moat | 20 | Gross margin + return on equity |
| Execution | 10 | Profitable, low debt, can pay short-term bills |
| Economy | 30 | Same for every stock: less when unemployment is rising or the 10-year Treasury yield is high |

80+ is **Strong**, 70–79 **Good**, 60–69 **Fair**, under 60 **Weak**.

- **Override any part** (EPS, growth or a score part) from the breakdown. **Reset** puts the automatic number back.
- **Edits keep up with the data:**
  - Each edit remembers the automatic number it replaced. If that number moves (EPS by more than 2%, growth by more than half a point, any change in score points), the breakdown says so, e.g. *"Growth: automatic is now 13.9% (was 20% when you edited)"*, with **Use automatic** or **Keep mine**. The ticker gets a **Check edit** pill on the Research list and a **check** pill on holdings.
  - **EPS edits end 3 days after the company's next earnings report,** because EPS changes then. The automatic EPS comes back and the breakdown tells you, with **Use mine again** if you still want yours.
  - If your number matches the automatic one, you're asked to switch to automatic so it keeps updating.
- **ETFs and loss-making companies** get no fair value or score, because there are no positive earnings to value.
- **Everything is automatic:** company data from Finnhub, analysts' forecasts from Financial Modeling Prep and economic numbers from FRED, refreshed daily. A new ticker fills in with "Get prices now", or at 4:45 PM.

---

## 7. Allocation

Two kinds of targets:

| Target | Where you set it | Covers |
|---|---|---|
| **Split** | Portfolios page → Allocation → **Edit split** | How brokerage money divides between brokerage accounts (e.g. Long Term 90%, Equity Trades 10%) |
| **Position plan** | Each portfolio's page → **Plan** → **Set / Edit plan** | A target % per ticker in that account (e.g. VOO 40%, NVDA 20%) |
| **Mix by type** | Each portfolio's page → **Plan** → **Set / Edit targets** | That one account's ETFs / Stocks / Bonds / Options / Cash. With a position plan, this is worked out from the plan instead |

Retirement accounts are never in the split, because money can't move freely in or out of them.
The Allocation card on Portfolios lists every account with **On target**, **N off target** or
**No targets**; open a line to see that account's mix, with the dollars to add or trim.

- **Types:** ETFs, Stocks, Bonds, Options, Cash.
- **Not counted:** margin, and sold options (covered calls, sold puts), which are obligations rather than holdings.
- **How types are detected:** from the exchange's own listing. ETFs count as ETF; ETFs whose names say bond, treasury or T-bill count as Bond; stocks, ADRs and REITs count as Stock.
- **To change a ticker's type,** open its type row (e.g. ETFs) and pick a type next to it.
- **Position plan:** enter a ticker and its % on each row (**+ Add ticker** for more); whatever doesn't add up to 100% stays as cash. Save is blocked while a row is missing its ticker or %, a ticker is listed twice, or the total is over 100%. Each ticker shows its target, where it is now, and what to buy or trim. Tickers you hold but didn't plan show "not in your plan"; planned tickers you don't own yet show "not owned yet". The holdings table shows each ticker's target under its weight.
- **Add money** (Plan tab): type an amount and it suggests buys only, nothing sold, going first to whatever is furthest below its target. It uses the account's free cash first; anything more counts as new money.
- **Plan notes** (Plan tab): your rules for the account. Saved as you type.
- **Thesis** (any ticker's fair value breakdown): why you own it, what would make you sell, and a review date. From that date the ticker shows an amber **review** pill in the holdings table and the plan.
- **Reading the bars:** the white marker is the target. **On target** (green) means within ± your tolerance (default 5%). **Over / Under** (amber) shows the gap, with the dollars to **add** or **trim**.
- **Mix targets:** presets (Aggressive to Defensive) or your own numbers. Each mix must add up to 100%.

---

## 8. Health check: what each warning means

The Health check card on Portfolios re-adds every number from the Activity history and
lists anything that doesn't match. **No warnings means every share, cost and cash figure is
backed by entries.**

| Warning | Means | Do |
|---|---|---|
| **Shares** / **Average cost** | A holding differs from what its entries add up to | Find the missing or wrong entry in Activity; edit or add it |
| **Cash** | Cash differs from the sum of entries | Usually an entry was missed. **Set balance** to the broker's number also fixes it, as a recorded correction |
| **Position** | An option or put has a missing or extra open/close entry | Undo and redo that position |
| **Covered call** | Open covered calls need more shares than you hold | Check the share entries or the call's contracts |
| **Price** | A ticker that used to price has fallen behind | Possibly delisted or renamed: set a manual price, or sell / transfer it |
| **Daily value** | A portfolio missed a daily pricing run | Usually clears after the next run. If it persists, check the worker (section 9) |

A brand-new ticker with no price yet isn't a warning. It shows a "Waiting for a first price"
banner with a **Get prices now** button instead.

---

## 9. Behind the scenes

| Part | Lives on | Does |
|---|---|---|
| Website | Vercel | Every page. Deploys automatically on each push to `main` |
| Database and sign-in | Supabase | All data; each user sees only their own rows |
| Worker | Fly.io (`trading-journal-worker`) | Trade sync every 15 min; prices + research daily at 4:45 PM New York time |
| Market data | Twelve Data, Finnhub, FRED (all free tiers) | Prices and trade charts; company data; economic numbers |

**Total cost: $0/month** on free tiers.

### When something changes in the code

1. **Database changes first.** Run each new file in `supabase/migrations/` in the Supabase SQL editor, oldest first. Every migration is safe to run twice.
2. **Worker:** `fly deploy` from the `worker` folder.
3. **Website:** push to `main`; Vercel builds it.

### Handy commands (from the `worker` folder)

| Command | Does |
|---|---|
| `fly logs` | Watch the worker |
| `fly ssh console -C "python sync.py --once"` | One trade sync now |
| `fly ssh console -C "python sync.py --prices-once"` | Price everything now |
| `fly ssh console -C "python sync.py --research-once"` | Refresh research data now |

### If something looks wrong

| Symptom | Likely cause |
|---|---|
| "Synced" time is old | Outside market hours (normal), or the worker is down: check `fly logs` |
| A page says a table or column doesn't exist | A migration hasn't been run yet |
| Research or allocation cards are empty | Research migration not run, `FINNHUB_API_KEY` not set, or the first daily run hasn't happened yet |
| Portfolio value looks a day old | Prices are daily closes. During market hours the latest close is yesterday's |
| A numbers mismatch with the broker | The Health check will say where; fees aren't recorded on portfolio entries, so small gaps are expected |

---

## 10. Ground rules

These are deliberate and worth keeping as the app grows:

- **Trading and Wealth stay separate.** Day trades never feed portfolios or net worth.
- **Portfolio numbers come only from entries.** No direct edits to shares, cost or cash; the database refuses them.
- **History is never deleted.** Undo and edit void the old entry and keep it.
- **Retirement accounts are planned on their own,** never in the brokerage split.
- **Secrets never go in code or the database.** API keys live in Fly.io and Vercel settings.
- **No account numbers.** Store nicknames only.
