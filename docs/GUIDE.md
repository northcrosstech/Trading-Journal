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
| **Wealth** | Long-term money: what you own, what you owe, and your investments | Overview, Portfolios (each one listed by name), Net worth (with a Cash flow tab), Research, Settings |

**The two never mix.** Day-trading results don't feed into portfolios or net worth, so a
good or bad trading week never distorts your long-term picture.

Each person signs in with their own login and only ever sees their own data.

### Getting around

- **Log** (top of the Wealth sidebar, or press **L**): pick a portfolio and the quick buy/sell form opens. On a portfolio page it opens for that portfolio straight away. The picker can also open the Deposit or Option form.
- **Search** (**Ctrl+K**, or the Search row in the sidebar): type a page, a portfolio or a ticker you hold.
- **Switching sides** takes you back to the page you left on that side, and the app opens on the side you used last.
- **Settings** has a Trading group and a Wealth group, and opens on the side you came from.

---

## 2. Your routines

| When | What | Where |
|---|---|---|
| **Every trading day** | Nothing to do. Trades sync every 15 minutes in market hours; prices and research update at 4:45 PM New York time | Automatic |
| **After trading** | Review closed trades: whose idea it was, what went well or badly, the setup | Review |
| **When you buy, sell or move money** in a portfolio | Record it as an entry so cash and shares stay right | **Log** in the sidebar (or press L), or the Log menu on the portfolio page |
| **Start of each month** (by the 15th) | **Close last month:** enter each account's balance as of the last day, mark payments paid, then press Close | The amber "Close {month}" banner, then the close card on Net worth |
| **Now and then** | Glance at "Needs attention" on Overview and the **Plan** tab on Portfolios (it shows how many targets are off) | Overview, Portfolios |

### Closing a month

Net worth is built from month-end balances, so each month needs closing once it's over.

- **From the 1st,** an amber banner appears: *"Close October · 5 of 8 balances confirmed"*. After the 15th it's marked overdue, but nothing closes by itself.
- **Use the balance on the last day of the month** from each statement. Debts are entered as positive numbers; the app subtracts them.
- **While a month is waiting to be closed,** Net worth leads with the close card, then Balances, then Monthly payments. The headline numbers, yearly chart and composition sit below in a collapsed **Breakdown** section. The close card shows progress ("6 of 8 balances · 3 of 4 payments"), and each line jumps to the first thing still missing.
- **Type down the column:** Enter moves to the next balance, and Enter on the last one saves. What you have typed stays put while you mark payments or add an account.
- **Typed balances wait for you.** Leave Net worth before saving and they are still there, marked unsaved, when you come back in the same browser tab. Closing the tab drops them.
- **Archiving a portfolio doesn't rewrite the past.** It leaves Net worth and Cash flow from the month you archive it; earlier months keep its value.
- **Save only writes what you changed or confirmed.** A number carried from last month stays marked "carried" until you type in it, press Enter in it, or tick **unchanged**. Accounts with a carried number don't count as done.
- **Mark payments paid** under Monthly payments: one click per payment, or **Mark all paid**. Each shows an Undo for a few seconds. To record a different amount or date, use the row's menu. The card's title names both months ("October statements · due in November").
- **Press Close** in the month-end close card on Net worth. Months close in order, and a closed month's balances and payments are locked.
- **To correct a closed month, press Reopen** and give a reason. Later closed months reopen with it. Fix the numbers, then close them again in order. Every close and reopen is kept in the month's history.
- **What a correction changes:** that month's cash flow and the next month's. Balances already saved for later months stay as they are; a later month without its own balance carries the new number.
- **While closed,** you also can't delete an account with balances in that month, change its category, or change its open or close date to a closed month. Renaming is fine. To retire an account, close it from a later month.
- **Portfolios aren't locked:** a closed month's portfolio lines still come from saved daily values, not a copy taken at closing.

**Which month Net worth opens on:**
- **From the 6th to the end of the month,** it opens on the current month.
- **On the 1st–5th,** it opens on the month waiting to be closed.
- **After the 5th,** an unclosed month keeps its banner, with an **Open** button.

**Missing a balance isn't fatal.** A month without one uses the last balance you entered,
marked "carried", until you fill it in.

### Monthly payments

| Debt | Set up with | What's due |
|---|---|---|
| Mortgage, auto loan, personal loan | Payment amount + due day | That amount, on that day **next month** (October's payment is due in November) |
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
- **A failed sync says so.** The sidebar reads "Sync failed" and a red banner appears above the Trading pages with the reason and a **Sync now** button.
- **An option that expired worthless** has no closing order at Webull. Close it by hand on its trade page. Once you do, the sync stops changing it.

---

## 4. Wealth pages

| Page | What it shows |
|---|---|
| **Overview** | A **Needs attention** list (Health check problems, options expiring in the next 30 days or past expiration, tickers waiting for a price), the freedom gauge, three headline numbers (**Net worth**, **Investments**, **Expected dividends**), **why last month's net worth changed**, and each portfolio. Click a headline number to open the page behind it. The close banner shows here too |
| **Net worth** | Everything you own minus everything you owe, by month. Two tabs: **Balances** (monthly balances, Monthly payments, the month-end close, and a Breakdown section with the yearly chart and what's in each category) and **Cash flow**. One month stepper at the top serves both |
| **Cash flow** (a tab on Net worth) | What you kept each month, worked out from balances alone (no income entry): cash saved + invested + debt paid down, reconciled to the change in net worth. Opens on last month, the latest one with a full set of balances |
| **Portfolios** | All portfolios together. The headline numbers stay on top, with five tabs under them: **Summary** (a card per portfolio, the Health check, archived portfolios), **Positions** (**What I own**: every ticker added up across portfolios), **Plan** (**Targets**: are you on target across accounts), **Performance** (value, allocation, returns) and **Income** (dividends and option premium received by month, then what each ticker is expected to pay) |
| **Portfolio page** | Five tabs, named like the ones on Portfolios: **Positions** (stocks, funds and options, with the biggest gains and losses above the table), **Plan** (with each position's Research rating and a "Worth a look" list), **Performance** (value, allocation, returns), **Income** (this portfolio's dividends and option premium by month, then its dividends per ticker) and **Activity**. **Log** is the one button in the header; rename, change type and archive are under **⋯** next to it. A strip at the top appears only when something needs you: positions off plan (with what to buy or trim, and **Log all**), an option about to expire, a ticker waiting for a price, or numbers that don't match the entries |
| **Research** | Fair value, score and next earnings date for everything you hold, plus a watchlist |

### Reading the numbers

These show figures the app already works out, in the place you'd look for them. None of them is a new calculation.

- **Why net worth changed** (Overview). Last month's change in one sentence, split into cash saved, invested, debt paid down, investment growth and other changes: the same figures as the Cash flow tab. If some balances for the month were carried instead of entered, the card says which accounts and shows no split, because it would be a guess.
- **Month recap** (Net worth). Opens by itself when you close a month, and from the **Recap** button on any closed month: the change and why, the portfolio that grew the most and the one that fell the most, dividends and option premium received, and the payments you made.
- **Debt-free date** (Monthly payments). The latest payoff month among your loans at current payments, and the interest still to pay. A loan with no rate entered counts as 0%. If only some debts have a fixed payment, the line says how many it covers.
- **What I own** (Portfolios). One row per ticker across all active portfolios: shares, value, share of the total, gain, and which portfolios hold it. Cash and options have their own rows. A ticker above 20% of the total is marked **Large position**. A holding with no price yet is left out of the percentages and listed in a footnote.
- **Income** (Portfolios and each portfolio, Income tab). Dividends and option premium for each of the last 12 months and the month so far, with this year's total and the monthly average. Premium is what you received for options you sold, less what you paid to buy any back; options you bought are trades, not income.
- **Biggest gains and losses** (a portfolio's Positions tab). Up to three holdings that are up the most and three that are down the most, in dollars against cost. Switch to the latest day's change with the toggle. Click one to jump to its row. Hidden when the portfolio has fewer than three priced holdings.
- **Worth a look** (a portfolio's Plan tab). Positions that are under their target and that Research rates cheap (price below 85% of fair value), furthest under target first, with a button that fills in the buy. It's a shortlist, not a recommendation. A ticker in your plan that you don't own yet is rated against its latest close.

### How investments reach net worth

- **Portfolio-linked lines:** each portfolio's value on the last trading day of the month fills its line (Brokerage, 401k, Traditional IRA or Roth IRA) automatically.
- **Margin:** a portfolio with negative cash (margin used) shows that as a separate **Margin loans** debt.
- **Everything else** (home, cash, cards, loans) is a balance you enter.

---

## 5. Portfolios: how entries work

**The one rule:** shares, average cost and cash change **only through entries** (Activity).
The holding's pencil edits only a manual price. That's what keeps every number traceable.

**Physical gold and silver:** use the ticker **GOLD** or **SILVER**, with the quantity in troy
ounces of pure metal (1 oz = 31.1 g) and your cost per ounce, premium included. Enter each
purchase with **Log → Shares I already own** on its own date. The price is the spot price per
troy ounce, updated after each day's close: gold from **XAU/USD** (Twelve Data), silver from
**XAG/USD** (gold-api.com). The pair shows under the price, and research skips both.

| You did | Use | Effect on returns |
|---|---|---|
| Put money in / took money out | **Log → Deposit / Withdraw**, or click the **Cash** card | None: it's your money, not a gain |
| Bought shares | **Click the position** (or Log → Buy or sell) | None: cash became shares |
| Already owned shares before using the app | **Log → Shares I already own** | None: counted as money in at the last saved price. If the app has no price for the ticker yet, the form asks for today's price |
| Sold shares | **Click the position** (or Log → Buy or sell) | The gain or loss counts |
| Got a dividend | **Log → Dividend**, or **Record** on the Income tab | Counts as earnings |
| Moved shares between portfolios | **Log → Transfer** | None on either side |
| Stock split (or reverse split) | **Log → Stock split** | None: shares × ratio, cost ÷ ratio |
| Broker's cash differs, or you're on margin | **Log → Match broker balance** (negative for margin) | None as a correction; ticked as interest or fees it lowers returns |
| Options and sold puts | **Log → Option**, or the **Options** card on Positions | Premiums and closes count |

**Option prices are per share,** as brokers quote them (e.g. 4.20). The app multiplies by 100 × contracts.

### Options as one position

The Options card groups by stock, then by contract. Cash-secured puts and other options are in the same list.

- **Each stock has a line** showing the shares you hold, how many are covered by sold calls, how many are free, and the last price.
- **Each contract is one line.** Buy the same contract twice and it shows as "×2" with the totals. Open the line to see each purchase with its own date, price and menu.
- **+ Add** opens the option form filled in with that contract, so you type only the contracts and the price.
- **Actions on a contract line cover every purchase in it:** Update price, Sell to close or Buy back, Expired worthless, Assigned, Exercise. Each asks for a date. If one purchase can't be saved, a note on the card says which were recorded and which weren't.
- **To close only some contracts, lower the count.** Sell to close, Buy back, Expired worthless, Assigned and Exercise each have a **Contracts** box filled in with all of them. Type a smaller number and the oldest purchases go first, each at its own cost. When that takes only part of a purchase, the purchase is split in two: Activity shows the original crossed out and replaced by two entries with the same date and price. Undoing the close later leaves those two as open purchases, shown as one line.

### Logging buys and sells from your positions

The quickest way to record trades:

1. **Click a position.** A form opens under it with the ticker, today's date and the last price filled in.
2. **Pick Bought or Sold** and type the shares. **All** fills in your whole position for a sale. Change the price to your fill price, and add the fee if there was one.
3. **More than one trade?** Press **Add another** for a new line (any ticker, bought or sold), or **paste rows** copied from your broker or a spreadsheet (ticker, shares, price; the word "sold" or a negative share count marks a sale). Each row becomes a line for you to check. For a ticker you don't hold yet, use **New ticker** above the table.
4. **Check the cash before → after** at the bottom against your broker, then press **Log**.

Every line is saved together, or none are: if one line has a problem (e.g. selling more than you hold), nothing is saved and that line is marked. Each line still becomes its own Activity entry, so you can edit or undo any one later.

**Fees** count: on a buy they're added to your cost (so average cost includes them, like your broker's), on a sale they come off what you receive. The Activity list shows the fill price and the fee.

**Behind on logging?** Each portfolio shows **Last entry** with a date, on its card and above its holdings, so you know where to pick up.

### Fixing a mistake

- **Edit** an entry to correct it, or **Undo** to reverse it. Nothing is deleted: the original stays as history ("Show undone or edited entries").
- **Undo newest first for a ticker.** An entry that changed a holding can only be undone while it's the newest entry for that ticker in that portfolio. Entries that can't be changed show a lock; click it to see why ("2 newer VOO entries: undo those first").
- **A refused change keeps what you typed.** The form stays open with the reason.
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

- **Override any part** (EPS, growth or a score part) from the breakdown. **Use automatic** puts the automatic number back.
- **Edits keep up with the data:**
  - Each edit remembers the automatic number it replaced. If that number moves (EPS by more than 2%, growth by more than half a point, any change in score points), the breakdown says so, e.g. *"Growth: automatic is now 13.9% (was 20% when you edited)"*, with **Use automatic** or **Keep mine**. The ticker gets a **Check edit** pill on the Research list and a **check** pill on holdings.
  - **EPS edits end 3 days after the company's next earnings report,** because EPS changes then. The automatic EPS comes back and the breakdown tells you, with **Keep mine** if you still want yours.
  - If your number matches the automatic one, you're asked to switch to automatic so it keeps updating.
- **ETFs and loss-making companies** get no fair value or score, because there are no positive earnings to value.
- **Everything is automatic:** company data from Finnhub, analysts' forecasts from Financial Modeling Prep and economic numbers from FRED, refreshed daily. A new ticker fills in with "Get prices now", or at 4:45 PM.

---

## Towards financial freedom

The gauge at the top of **Wealth** shows how much of the money you need to stop depending on a paycheck you already have. Press **Details** to see the breakdown or change your inputs. The target, milestones and time estimate follow what you type, before you save.

- **Freedom money** = brokerage + retirement + cash and emergency fund − cards, car loans, margin and other debts. Retirement money counts in full, before taxes. The home, cars and miscellaneous items are left out. Day trading plays no part in it.
- **Freedom number** = ongoing spending × 12 ÷ your withdrawal rate (4% means 25 times), plus your mortgage balance as a one-time cost. Every mortgage payment lowers it, and the mortgage payment itself stays out of spending.
- **Spending:** the app suggests your cards' average month-end balance over 12 months + escrow + the other bills you enter. Type your own number to replace it. Cards with a fixed payment count as loans, so they aren't in it. If you carry card balances, the suggestion runs high.
- **Savings** only affects the time estimate. The app suggests your average "kept" from Cash flow; add 401k contributions if they aren't logged in a portfolio.
- **Time estimate and Coast** use your growth assumption (5% after inflation by default). They're estimates, not promises.

---

## 7. Allocation

Two kinds of targets:

| Target | Where you set it | Covers |
|---|---|---|
| **Split** | Portfolios page → **Plan** tab → **Edit split** | How brokerage money divides between brokerage accounts (e.g. Long Term 90%, Equity Trades 10%) |
| **Position plan** | Each portfolio's page → **Plan** → **Set / Edit plan** | A target % per ticker in that account (e.g. VOO 40%, NVDA 20%) |
| **Mix by type** | Each portfolio's page → **Plan** → **Set / Edit targets** | That one account's ETFs / Stocks / Bonds / Options / Cash. With a position plan, this is worked out from the plan instead |

Retirement accounts are never in the split, because money can't move freely in or out of them.
The Targets card is on the Portfolios page's **Plan** tab; the tab's label shows how many targets are off. It lists every account with **On target**, **N off target** or
**No targets**; open a line to see the positions that are off plan and what to buy or trim (or, for an account without a position plan, its mix by type).

- **Types:** ETFs, Stocks, Bonds, Options, Cash.
- **Not counted:** margin, and sold options (covered calls, sold puts), which are obligations rather than holdings.
- **How types are detected:** from the exchange's own listing. ETFs count as ETF; ETFs whose names say bond, treasury or T-bill count as Bond; stocks, ADRs and REITs count as Stock.
- **To change a ticker's type,** open its type row (e.g. ETFs) and pick a type next to it.
- **Position plan:** enter a ticker and its % on each row (**+ Add ticker** for more); whatever doesn't add up to 100% stays as cash. Save is blocked while a row is missing its ticker or %, a ticker is listed twice, or the total is over 100%. Each ticker shows its target, where it is now, and what to buy or trim. Tickers you hold but didn't plan show "not in your plan"; planned tickers you don't own yet show "not owned yet". The holdings table shows each ticker's target under its weight.
- **On the Positions tab,** each holding shows its weight → target and what to do: **▲ Buy 5 sh** or **▼ Trim 9 sh** (whole shares, rounded down, back to the exact target), **✓ On plan**, or **Not in plan**. Click the action to open the trade already filled in, or press **Log all** beside the off-plan summary to open every suggested trade in one form (sales first). Planned tickers you don't own yet are listed at the bottom, and **Off plan only** hides everything that needs nothing.
- **Sorting:** click any column header on Positions, Plan, Options, Dividends or Activity to sort by it. Click again to flip the order, and a third time to go back to the default (positions by value). Each table remembers your choice on that device. Empty values always sort last; on Plan, the Options and Cash rows stay at the bottom.
- **Add money** (Plan tab): type an amount and it suggests buys only, nothing sold, going first to whatever is furthest below its target. It uses the account's free cash first; anything more counts as new money.
- **Plan notes** (Plan tab): your rules for the account. Saved as you type.
- **Thesis** (any ticker's fair value breakdown): why you own it, what would make you sell, and a review date. From that date the ticker shows an amber **review** pill in the holdings table and the plan.
- **Reading the bars:** the white marker is the target. **On target** (green) means within ± your tolerance (default 5 points), or within a quarter of the target if that's smaller (the 5/25 rule), so small positions are judged fairly: a 5% target is on target only between 3.75% and 6.25%, a 40% target between 35% and 45%. A 0% target allows half a point. **Over / Under** (amber) shows the gap, with the dollars to **add** or **trim**.
- **Mix targets:** presets (Aggressive to Defensive) or your own numbers. Each mix must add up to 100%.

---

## 8. Health check: what each warning means

The Health check (on Portfolios, above the tabs when it finds something and at the foot of Summary when all is well; in "Needs attention" on Overview; and at the top of the portfolio it concerns) re-adds every number from the Activity history and
lists anything that doesn't match. **No warnings means every share, cost and cash figure is
backed by entries.**

| Warning | Means | Do |
|---|---|---|
| **Shares** / **Average cost** | A holding differs from what its entries add up to | Find the missing or wrong entry in Activity; edit or add it |
| **Cash** | Cash differs from the sum of entries | Usually an entry was missed. **Match broker balance** to the broker's number also fixes it, as a recorded correction |
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
| A red "The last sync failed" banner on the Trading pages | The latest sync run ended in an error; the banner shows the reason. Press **Sync now** to retry. If it keeps failing, the Webull approval may have lapsed: check `fly logs` |
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
