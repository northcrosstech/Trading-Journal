import type { FillAction, FillInput } from './manualTrade'

/** TS port of worker/transform.py's group_trades -- walks a signed net-position ledger
 * per contract/symbol in chronological order, tagging each fill open/add/trim/close
 * exactly like the Webull sync worker does, so a Robinhood-imported trim and a
 * Webull-synced trim are the same data shape. Deliberately mirrors that file's
 * structure closely; see worker/transform.py for the reference implementation this
 * was verified against (scripts/verify below).
 *
 * Unlike Webull's API, Robinhood's CSV only labels open/close intent for OPTIONS
 * (BTO/STO = open, STC/BTC = close) -- plain share Buy/Sell rows carry no such label.
 * intendedAction is therefore optional: present (and authoritative) for options,
 * undefined for shares, where open/close is inferred purely from the net-quantity walk. */

export type RhSide = 'buy' | 'sell'
export type RhAssetType = 'stock' | 'option'

export type RhExecutionInput = {
  key: string // contract_key ("SYMBOL|strike|expiration|type") for options, symbol for shares
  assetType: RhAssetType
  symbol: string
  optionType?: 'call' | 'put'
  strike?: number
  expiration?: string
  /** For a normal fill this is the real side. For an OEXP/OASGN synthetic close
   * (forceCloseAtZeroPrice: true) it's a placeholder -- the real side (buy to close a
   * short, sell to close a long) is resolved from the running position at grouping
   * time, since expiration/assignment rows don't say which side they're closing. */
  side: RhSide
  /** 'open' | 'close' for options (from BTO/STO/STC/BTC); undefined for shares. */
  intendedAction?: 'open' | 'close'
  /** OEXP (expired worthless) and OASGN (assigned) rows: the option always closes at
   * exactly $0 additional premium, and always closes whatever's open -- side is
   * resolved dynamically rather than trusted from the row. */
  forceCloseAtZeroPrice?: boolean
  quantity: number
  price: number
  /** Robinhood's actual net cash flow for this row (already fee-inclusive), when
   * known -- lets the dry-run preview show the implied fee (price x qty x multiplier
   * vs. amount) without a second pass over the CSV. Null for OEXP/OASGN, which carry
   * no dollar amount. */
  amount: number | null
  filledAt: string // ISO timestamp
  note?: string // e.g. "Expired worthless", "Assigned"
  sourceRowIndexes: number[]
}

export type RhTaggedExecution = RhExecutionInput & { tag: FillAction }

export type RhGroupedTrade = {
  key: string
  assetType: RhAssetType
  symbol: string
  optionType?: 'call' | 'put'
  strike?: number
  expiration?: string
  direction: 'long' | 'short'
  status: 'OPEN' | 'CLOSED'
  executions: RhTaggedExecution[]
  /** true = a standalone closing fill with no matching open in this export --
   * avg entry is unknowable from the data, not just "not yet computed." */
  orphanEntry: boolean
  notes: string[]
}

const EPS = 1e-9
const isZero = (x: number) => Math.abs(x) < EPS

function splitExecution(e: RhExecutionInput, quantity: number): RhExecutionInput {
  // A flip is rare (one aggregated fill crossing net through zero) -- prorate amount
  // the same way price/quantity already imply, so a split stays internally consistent.
  const fraction = e.quantity ? quantity / e.quantity : 0
  return { ...e, quantity, amount: e.amount === null ? null : e.amount * fraction }
}

export function groupRobinhoodExecutions(executions: RhExecutionInput[]): { trades: RhGroupedTrade[]; warnings: string[] } {
  const byKey = new Map<string, RhExecutionInput[]>()
  for (const e of executions) {
    const arr = byKey.get(e.key)
    if (arr) arr.push(e)
    else byKey.set(e.key, [e])
  }

  const trades: RhGroupedTrade[] = []
  const warnings: string[] = []

  for (const [key, execsForKey] of byKey) {
    // Executions arrive in the caller's chronological order (the CSV, reversed to
    // oldest-first); this sort is a stable tie-break only, matching transform.py's
    // sort-by-filled_at.
    const sorted = [...execsForKey].sort((a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime())

    let net = 0
    let current: RhGroupedTrade | null = null

    const startTrade = (direction: 'long' | 'short'): RhGroupedTrade => {
      const t: RhGroupedTrade = {
        key,
        assetType: sorted[0].assetType,
        symbol: sorted[0].symbol,
        optionType: sorted[0].optionType,
        strike: sorted[0].strike,
        expiration: sorted[0].expiration,
        direction,
        status: 'OPEN',
        executions: [],
        orphanEntry: false,
        notes: [],
      }
      trades.push(t)
      return t
    }

    const orphanClose = (e: RhExecutionInput) => {
      const t: RhGroupedTrade = {
        key,
        assetType: e.assetType,
        symbol: e.symbol,
        optionType: e.optionType,
        strike: e.strike,
        expiration: e.expiration,
        // Closing a sell means a long was held; closing a buy (covering) means a
        // short was held -- either way, entry predates this export.
        direction: e.side === 'sell' ? 'long' : 'short',
        status: 'CLOSED',
        executions: [{ ...e, tag: 'close' }],
        orphanEntry: true,
        notes: [e.note ?? 'entry pre-dates this import -- no matching open in the export'],
      }
      trades.push(t)
      warnings.push(`${e.symbol}: ${t.notes[0]} (closing fill at ${e.filledAt})`)
    }

    for (const raw of sorted) {
      // OEXP/OASGN rows don't say which side they're closing -- resolve it from the
      // running position: closing a long (net > 0) is a sell, closing a short
      // (net < 0) is a buy. At net === 0 (orphan) the resolved side only feeds
      // orphanClose's long/short labeling below, so any deterministic choice works;
      // 'sell' matches "closes a long" the same way the plain-share orphan path does.
      const side: RhSide = raw.forceCloseAtZeroPrice ? (net > 0 ? 'sell' : net < 0 ? 'buy' : 'sell') : raw.side
      const e: RhExecutionInput = raw.forceCloseAtZeroPrice ? { ...raw, side } : raw

      const signedDelta = side === 'buy' ? e.quantity : -e.quantity

      if (isZero(net)) {
        const isOrphanClose = e.intendedAction === 'close' || (e.intendedAction === undefined && e.side === 'sell')
        if (isOrphanClose) {
          orphanClose(e)
          continue // net stays 0 -- an orphan close never seeds a fictitious residual
        }

        const t = startTrade(signedDelta > 0 ? 'long' : 'short')
        t.executions.push({ ...e, tag: 'open' })
        net = signedDelta
        if (isZero(net)) {
          t.status = 'CLOSED'
          current = null
        } else {
          current = t
        }
        continue
      }

      if (current === null) continue // unreachable: net != 0 implies a trade is in progress
      const c = current
      const newNet = net + signedDelta
      const flipped = !isZero(newNet) && ((net > 0 && newNet < 0) || (net < 0 && newNet > 0))

      if (flipped) {
        const closeQty = Math.abs(net)
        const reopenQty = e.quantity - closeQty
        warnings.push(
          `${key}: fill at ${e.filledAt} flips net position (${net} -> ${newNet}) -- split into a close of the open trade plus a new open trade at the same fill price.`,
        )
        c.executions.push({ ...splitExecution(e, closeQty), tag: 'close' })
        c.status = 'CLOSED'

        const next = startTrade(newNet > 0 ? 'long' : 'short')
        next.executions.push({ ...splitExecution(e, reopenQty), tag: 'open' })
        current = next
        net = newNet
        continue
      }

      const sameDirection = (net > 0 && signedDelta > 0) || (net < 0 && signedDelta < 0)
      c.executions.push({ ...e, tag: sameDirection ? 'add' : isZero(newNet) ? 'close' : 'trim' })
      net = newNet
      if (isZero(net)) {
        c.status = 'CLOSED'
        current = null
      }
    }

    if (current !== null) {
      current.notes.push(`still open at end of export (residual quantity ${net})`)
    }
  }

  return { trades, warnings }
}

/** A grouped trade's tagged executions, converted to the same FillInput[] shape
 * summarizeFills (lib/manualTrade.ts) already consumes for manual entries -- so
 * Robinhood-imported trades reuse the exact same avg-entry/avg-exit/P&L math as
 * every other manual trade in this app, instead of a second implementation. */
export function tradeToFillInputs(trade: RhGroupedTrade): FillInput[] {
  return trade.executions.map((e) => ({ action: e.tag, time: e.filledAt, price: e.price, quantity: e.quantity }))
}
