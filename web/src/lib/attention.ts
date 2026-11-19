import type { AuditProblem, CspPosition, OptionPosition, Portfolio } from './database.types'
import { dateFmt } from './format'

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

const daysUntil = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000)
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

/** Open options and sold puts that are past their expiry date or reach it within `within`
 * days, soonest first. Pass open positions of portfolios that aren't archived. */
export function expiryItems(today: string, portfolios: Portfolio[], options: OptionPosition[], csps: CspPosition[], within = 7): AttentionLink[] {
  const names = new Map(portfolios.map((p) => [p.id, p.name]))
  const rows = [
    ...options.map((o) => ({ id: `option-${o.id}`, portfolioId: o.portfolio_id, expiration: o.expiration, label: `${o.symbol} $${Number(o.strike)} ${o.option_type}${o.side === 'short' ? ' you sold' : ''}` })),
    ...csps.map((c) => ({ id: `put-${c.id}`, portfolioId: c.portfolio_id, expiration: c.expiration, label: `${c.symbol} $${Number(c.strike)} put you sold` })),
  ]
  return rows
    .map((r) => ({ ...r, days: daysUntil(r.expiration, today) }))
    .filter((r) => r.days <= within && names.has(r.portfolioId))
    .sort((a, b) => a.days - b.days || a.label.localeCompare(b.label))
    .map((r) => {
      const name = names.get(r.portfolioId) as string
      const when = r.days < 0 ? `expired ${dateFmt(r.expiration)} and is still open` : r.days === 0 ? 'expires today' : r.days === 1 ? 'expires tomorrow' : `expires in ${r.days} days`
      return {
        key: r.id,
        kind: 'expiry' as const,
        text: `${r.label} ${when}`,
        detail: r.days < 0 ? `In ${name}. Record how it ended: expired, assigned or closed.` : `In ${name} · ${dateFmt(r.expiration)}`,
        to: `/portfolios/${r.portfolioId}`,
        action: `Open ${name}`,
      }
    })
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
