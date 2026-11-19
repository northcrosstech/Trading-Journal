import type { AuditProblem, CspPosition, OptionPosition, Portfolio } from './database.types'
import { dateFmt } from './format'
import { contractLabel, daysTo, openContractLines, type ContractLine } from './optionLines'

/** One line of the Wealth overview's "Needs attention" list: what is wrong and where to fix it. */
export type AttentionLink = {
  key: string
  kind: 'health' | 'expiry' | 'price'
  text: string
  detail?: string
  to: string
  /** The link's label, e.g. "Open Activity". */
  action: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Health check problems, one line per portfolio. Null (the check isn't available) gives nothing. */
export function healthItems(problems: AuditProblem[] | null): AttentionLink[] {
  const byPortfolio = new Map<string, { name: string; count: number }>()
  for (const p of problems ?? []) byPortfolio.set(p.portfolio_id, { name: p.portfolio, count: (byPortfolio.get(p.portfolio_id)?.count ?? 0) + 1 })
  return Array.from(byPortfolio, ([id, { name, count }]) => ({
    key: `health-${id}`,
    kind: 'health' as const,
    text: `${plural(count, 'issue')} in ${name}`,
    detail: 'Its numbers don’t match its Activity history.',
    to: `/portfolios/${id}?tab=activity`,
    action: 'Open Activity',
  }))
}

const isSold = (l: ContractLine) => l.kind !== 'long_call' && l.kind !== 'long_put'
const lineName = (l: ContractLine) => `${contractLabel(l.symbol, l.strike, l.optionType)}${isSold(l) ? ' you sold' : ''}`

/** "today", "tomorrow" or "on Dec 18". No year: these dates are at most a month away. */
function expiresWhen(l: ContractLine, today: string): string {
  const days = daysTo(l.expiration, today)
  if (days <= 1) return days === 0 ? 'today' : 'tomorrow'
  const [y, m, d] = l.expiration.split('-').map(Number)
  return `on ${new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/** Open options and sold puts that are past their expiration or reach it within `within` days:
 * one line per portfolio, counting each contract once however many lots it was bought in.
 * Portfolios with something past expiration come first, then the soonest to expire. Pass open
 * positions and the portfolios that aren't archived. */
export function expiryItems(today: string, portfolios: Portfolio[], options: OptionPosition[], csps: CspPosition[], within = 30): AttentionLink[] {
  const rows: { item: AttentionLink; late: boolean; first: string }[] = []
  for (const p of portfolios) {
    const lines = openContractLines(
      options.filter((o) => o.portfolio_id === p.id),
      csps.filter((c) => c.portfolio_id === p.id),
    )
    // Lines come soonest first, so [0] of each list is its earliest expiration.
    const past = lines.filter((l) => daysTo(l.expiration, today) < 0)
    const soon = lines.filter((l) => daysTo(l.expiration, today) >= 0 && daysTo(l.expiration, today) <= within)
    if (past.length === 0 && soon.length === 0) continue

    const soonest = soon.length > 0 ? `${lineName(soon[0])}${isSold(soon[0]) ? ',' : ''} ${expiresWhen(soon[0], today)}` : ''
    let text: string
    let detail: string | undefined
    if (past.length > 0) {
      text = `${p.name}: ${past.length === 1 ? '1 option is past its expiration' : `${past.length} options are past their expiration`} and still open`
      const named = past.length <= 3 ? past.map(lineName).join(', ') : `${past.slice(0, 3).map(lineName).join(', ')} +${past.length - 3} more`
      detail =
        past.length === 1
          ? `${named} expired ${dateFmt(past[0].expiration)}. Record how it ended: expired, assigned or closed.`
          : `${named}. Record how each ended: expired, assigned or closed.`
      if (soon.length > 0) detail += ` Also expiring in the next ${within} days: ${soon.length === 1 ? soonest : `${soon.length} options, soonest ${soonest}`}.`
    } else if (soon.length === 1) {
      text = `${p.name}: ${lineName(soon[0])} expires ${expiresWhen(soon[0], today)}`
    } else {
      text = `${p.name}: ${soon.length} options expire in the next ${within} days (soonest ${soonest})`
    }
    rows.push({
      item: { key: `expiry-${p.id}`, kind: 'expiry', text, detail, to: `/portfolios/${p.id}?tab=positions`, action: 'Open Positions' },
      late: past.length > 0,
      first: (past[0] ?? soon[0]).expiration,
    })
  }
  return rows.sort((a, b) => Number(b.late) - Number(a.late) || a.first.localeCompare(b.first) || a.item.text.localeCompare(b.item.text)).map((r) => r.item)
}

/** Tickers that have never had a price, as one line. */
export function priceItems(pending: string[]): AttentionLink[] {
  if (pending.length === 0) return []
  const shown = pending.length <= 5 ? pending.join(', ') : `${pending.slice(0, 5).join(', ')} +${pending.length - 5} more`
  return [
    {
      key: 'prices',
      kind: 'price',
      text: `${plural(pending.length, 'ticker')} waiting for a first price: ${shown}`,
      detail: 'Their value isn’t counted yet. Prices update once a day after the close, or get them now on Portfolios.',
      to: '/portfolios',
      action: 'Open Portfolios',
    },
  ]
}
