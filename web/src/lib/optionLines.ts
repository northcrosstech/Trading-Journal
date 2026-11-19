import type { CspPosition, OptionPosition } from './database.types'

/** One purchase or sale of a contract, as stored: a row of option_positions or csp_positions. */
export type OptionLot = { source: 'option'; o: OptionPosition } | { source: 'csp'; c: CspPosition }

export type ContractKind = 'long_call' | 'long_put' | 'short_call' | 'short_put' | 'csp'

/** Every open lot of the same contract, shown as one position. Display only: nothing is
 * merged in the database, and every action still runs on the individual lots. */
export type ContractLine = {
  key: string
  symbol: string
  kind: ContractKind
  optionType: 'call' | 'put'
  strike: number
  expiration: string
  contracts: number
  /** Oldest first. */
  lots: OptionLot[]
}

export const daysTo = (iso: string, from: string) => Math.round((Date.parse(iso) - Date.parse(from)) / 86_400_000)

export const contractLabel = (symbol: string, strike: number, type: 'call' | 'put') => `${symbol} ${Number(strike)}${type === 'call' ? 'C' : 'P'}`

/** Strikes are compared as numbers, so 150 and 150.00 are the same contract. */
const keyOf = (symbol: string, kind: ContractKind, strike: number, expiration: string) => `${symbol}|${kind}|${Number(strike)}|${expiration}`

const opened = (l: OptionLot) => (l.source === 'option' ? l.o : l.c)

/** Open options and cash-secured puts grouped into contract lines, soonest expiration first. */
export function openContractLines(options: OptionPosition[], csps: CspPosition[]): ContractLine[] {
  const lines = new Map<string, ContractLine>()
  const add = (symbol: string, kind: ContractKind, optionType: 'call' | 'put', strike: number, expiration: string, contracts: number, lot: OptionLot) => {
    const key = keyOf(symbol, kind, strike, expiration)
    const line = lines.get(key)
    if (line) {
      line.contracts += contracts
      line.lots.push(lot)
    } else lines.set(key, { key, symbol, kind, optionType, strike: Number(strike), expiration, contracts, lots: [lot] })
  }
  for (const o of options)
    if (o.status === 'open') add(o.symbol, `${o.side}_${o.option_type}`, o.option_type, o.strike, o.expiration, o.contracts, { source: 'option', o })
  for (const c of csps) if (c.status === 'open') add(c.symbol, 'csp', 'put', c.strike, c.expiration, c.contracts, { source: 'csp', c })
  const out = [...lines.values()]
  for (const l of out)
    l.lots.sort((a, b) => opened(a).opened_on.localeCompare(opened(b).opened_on) || opened(a).created_at.localeCompare(opened(b).created_at))
  return out.sort((a, b) => a.expiration.localeCompare(b.expiration))
}
