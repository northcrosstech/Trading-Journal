import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FundamentalsRow, MacroIndicatorRow, ResearchOverrideRow } from './database.types'
import { fetchFundamentals, fetchMacroIndicators, fetchResearchOverrides, fetchResearchSettings, type ResearchSettings } from './wealthQueries'
import { macroFrom, research, type Overrides, type Research } from './research'
import { centralDateStr } from './format'

/** Fair value and score for a set of tickers: loads fundamentals, economic indicators, your
 * overrides and settings, and works everything out with the rules in lib/research.ts.
 * `prices` maps ticker -> the price to compare with fair value. */
export function useResearch(symbols: string[], prices: Map<string, number>) {
  const key = [...new Set(symbols)].sort().join(',')
  const [fund, setFund] = useState<Map<string, FundamentalsRow>>(new Map())
  const [macroRows, setMacroRows] = useState<MacroIndicatorRow[]>([])
  const [overrideRows, setOverrideRows] = useState<ResearchOverrideRow[]>([])
  const [settings, setSettings] = useState<ResearchSettings>({ growthCap: 30, economyOverride: null })
  const [ready, setReady] = useState(false)

  const load = useCallback(() => {
    const list = key ? key.split(',') : []
    Promise.all([fetchFundamentals(list), fetchMacroIndicators(), fetchResearchOverrides(), fetchResearchSettings()])
      .then(([f, m, o, s]) => {
        setFund(f)
        setMacroRows(m)
        setOverrideRows(o)
        setSettings(s)
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [key])
  useEffect(load, [load])

  const macro = useMemo(() => macroFrom(macroRows), [macroRows])
  const rows = useMemo(() => {
    const today = centralDateStr(new Date())
    const out = new Map<string, Research>()
    for (const s of key ? key.split(',') : []) {
      const o: Overrides = {}
      for (const r of overrideRows) if (r.symbol === s) o[r.field] = Number(r.value)
      out.set(s, research(s, fund.get(s) ?? null, prices.get(s) ?? null, macro, o, settings, today))
    }
    return out
  }, [key, fund, overrideRows, settings, macro, prices])

  return { rows, macro, settings, ready, reload: load }
}
