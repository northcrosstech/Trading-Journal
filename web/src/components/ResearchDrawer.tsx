import { useState } from 'react'
import { AlertTriangle, ChevronDown, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { ResearchOverrideField } from '../lib/database.types'
import {
  BASE_YIELD,
  GROSS_MARGIN_TABLE,
  GROWTH_TABLE,
  NO_GROWTH_PE,
  ROE_TABLE,
  VALUATION_TABLE,
  economyPoints,
  autoMoved,
  epsEditEnds,
  fairTone,
  fairWord,
  type EditCheck,
  type Macro,
  type Part,
  type Research,
} from '../lib/research'
import { setResearchOverride, setResearchSettings, type ResearchSettings } from '../lib/wealthQueries'
import { currency, dateFmt, priceFmt } from '../lib/format'
import { parseAmount, useDialog } from '../lib/dialogContext'
import { useToast } from '../lib/toastContext'
import { Drawer } from './ui/Drawer'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'
import { PILL_TONE, ScoreBadge } from './ResearchBits'

const PART_BAR: Record<string, string> = { green: 'bg-emerald-400', teal: 'bg-teal-400', neutral: 'bg-neutral-400', amber: 'bg-amber-400' }
const partTone = (p: Part) => (p.points === null ? 'neutral' : p.points / p.max >= 0.8 ? 'green' : p.points / p.max >= 0.6 ? 'teal' : p.points / p.max >= 0.4 ? 'neutral' : 'amber')
const fmt = (n: number | null, digits = 2) => (n === null ? '—' : Number(n.toFixed(digits)).toLocaleString())

/** The full breakdown for one ticker: how its fair value is worked out, each score part with
 * the numbers behind it, the next earnings report, and your overrides. */
export function ResearchDrawer({
  r,
  macro,
  settings,
  onClose,
  onChanged,
  onRemove,
}: {
  r: Research | null
  macro: Macro
  settings: ResearchSettings
  onClose: () => void
  onChanged: () => void
  onRemove?: () => void
}) {
  const { user } = useAuth()
  const dialog = useDialog()
  const toast = useToast()
  const [showHow, setShowHow] = useState(false)

  async function save(p: Promise<unknown>, message: string) {
    try {
      await p
      toast(message)
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  async function editNumber(opts: { title: string; label: string; current: number | null; hint: string; min?: number; max?: number; prefix?: string; suffix?: string }) {
    const v = await dialog.form({
      title: opts.title,
      description: 'Leave blank to go back to the automatic value.',
      submitLabel: 'Save',
      fields: [
        {
          name: 'v',
          label: opts.label,
          type: 'number',
          prefix: opts.prefix,
          optional: true,
          defaultValue: opts.current !== null ? String(Number(opts.current.toFixed(4))) : '',
          hint: opts.hint,
          validate: (s) => {
            if (s.trim() === '') return null
            const n = parseAmount(s)
            if (n === null) return 'Enter a number'
            if (opts.min !== undefined && n < opts.min) return `At least ${opts.min}`
            if (opts.max !== undefined && n > opts.max) return `At most ${opts.max}`
            return null
          },
        },
      ],
    })
    if (!v) return undefined
    return v.v.trim() === '' ? null : parseAmount(v.v)
  }

  /** What an edit remembers: the automatic number it replaces and, for EPS, when it ends
   * (a few days after the next earnings report). */
  const trackFor = (field: ResearchOverrideField, auto: number | null) => ({ autoValue: auto, expiresOn: field === 'eps' ? epsEditEnds(r?.earnings?.date ?? null) : null })

  async function override(field: ResearchOverrideField, title: string, label: string, current: number | null, auto: number | null, hint: string, range?: [number, number]) {
    if (!user || !r) return
    const ends = field === 'eps' ? epsEditEnds(r.earnings?.date ?? null) : null
    const v = await editNumber({
      title,
      label,
      current,
      hint: `${hint} Automatic: ${fmt(auto)}.${ends ? ` Your number is used until ${dateFmt(ends)}, after the next earnings report.` : ''}`,
      min: range?.[0],
      max: range?.[1],
    })
    if (v === undefined) return
    save(setResearchOverride(user.id, r.symbol, field, v, trackFor(field, auto)), v === null ? `${r.symbol}: back to automatic` : `${r.symbol}: ${label.toLowerCase()} set`)
  }

  function reset(field: ResearchOverrideField, label: string) {
    if (user && r) save(setResearchOverride(user.id, r.symbol, field, null), `${r.symbol}: ${label} back to automatic`)
  }

  /** Keep your number: it now replaces today's automatic one (and an EPS edit runs to the next report). */
  function keep(c: EditCheck) {
    if (user && r) save(setResearchOverride(user.id, r.symbol, c.field, c.value, trackFor(c.field, c.auto)), `${r.symbol}: keeping your ${c.label}`)
  }

  async function editPart(p: Part) {
    if (!user || !r) return
    if (p.key === 'economy') {
      const v = await editNumber({ title: 'Economy score (all stocks)', label: 'Points (0–30)', current: p.points, hint: 'Applies to every stock. Blank = automatic from unemployment and the 10-year yield.', min: 0, max: 30 })
      if (v === undefined) return
      save(setResearchSettings(user.id, { economy_override: v }), v === null ? 'Economy score back to automatic' : 'Economy score set for all stocks')
      return
    }
    override(p.key, `${p.label} · ${r.symbol}`, `Points (0–${p.max})`, p.points, p.auto, `From ${p.detail}.`, [0, p.max])
  }

  async function editGrowthCap() {
    if (!user) return
    const v = await editNumber({ title: 'Growth cap (all stocks)', label: 'Highest growth % used', current: settings.growthCap, hint: 'Growth forecasts can be extreme; fair value never uses more than this. Blank = 30%.', min: 1, max: 100 })
    if (v === undefined) return
    save(setResearchSettings(user.id, { growth_cap: v ?? 30 }), `Growth cap set to ${v ?? 30}%`)
  }

  const econ = economyPoints(macro)

  return (
    <Drawer
      open={r !== null}
      onClose={onClose}
      width="max-w-lg"
      title={r ? `${r.symbol}${r.name ? ` · ${r.name}` : ''}` : ''}
      subtitle={
        r ? (
          <span className="flex flex-wrap items-center gap-2">
            {r.price !== null && <span>{priceFmt(r.price)}</span>}
            {r.pct !== null && <Pill tone={PILL_TONE[fairTone(r.pct)]}>{Math.round(r.pct * 100)}% of fair value · {fairWord(r.pct)}</Pill>}
            <ScoreBadge r={r} size="sm" />
          </span>
        ) : undefined
      }
    >
      {r && (
        <div className="flex flex-col gap-6 text-sm">
          {r.checks.length > 0 && (
            <section className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
              <p className="flex items-center gap-1.5 font-medium text-amber-100">
                <AlertTriangle size={14} /> Check your edit{r.checks.length === 1 ? '' : 's'}
              </p>
              <ul className="mt-1.5 flex flex-col gap-2">
                {r.checks.map((c) => (
                  <li key={c.field} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-amber-200/90">
                      {c.status === 'ended' ? (
                        <>
                          Your {c.label} ({showValue(c.field, c.value)}) ended after the earnings report{c.endedOn ? ` (${dateFmt(c.endedOn)})` : ''}. The automatic{' '}
                          {showValue(c.field, c.auto)} is used now.
                        </>
                      ) : !autoMoved(c.field, c.auto, c.value) ? (
                        <>
                          Your {c.label} ({showValue(c.field, c.value)}) matches the automatic one now. Switch to automatic so it keeps updating.
                        </>
                      ) : (
                        <>
                          {c.label}: automatic is now {showValue(c.field, c.auto)}
                          {c.autoThen !== null ? ` (was ${showValue(c.field, c.autoThen)} when you edited)` : ''}. You set {showValue(c.field, c.value)}.
                        </>
                      )}
                    </span>
                    <span className="flex gap-1.5">
                      {c.status === 'changed' && !autoMoved(c.field, c.auto, c.value) ? (
                        <Button size="sm" onClick={() => reset(c.field, c.label)}>
                          Switch to automatic
                        </Button>
                      ) : (
                        c.status === 'changed' && (
                          <Button size="sm" variant="ghost" onClick={() => reset(c.field, c.label)}>
                            Use automatic
                          </Button>
                        )
                      )}
                      {c.status === 'ended' && (
                        <Button size="sm" variant="ghost" onClick={() => reset(c.field, c.label)}>
                          OK
                        </Button>
                      )}
                      {(c.status === 'ended' || autoMoved(c.field, c.auto, c.value)) && (
                        <Button size="sm" onClick={() => keep(c)}>
                          {c.status === 'ended' ? 'Use mine again' : 'Keep mine'}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Fair value */}
          <section>
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Fair value</h3>
              <span className="text-lg font-semibold tabular-nums text-white">{r.fair !== null ? currency(r.fair) : '—'}</span>
            </div>
            {r.kind === 'etf' && r.fair === null ? (
              <p className="mt-2 text-neutral-400">This is a fund (ETF): it has no earnings of its own, so there's no fair value. You can still enter an EPS below if you want one.</p>
            ) : null}
            <div className="mt-2 rounded-xl bg-(--card-raised) px-3 py-2.5 font-mono text-xs text-neutral-300">
              EPS {fmt(r.eps.value)} × ({NO_GROWTH_PE} + {fmt(r.growth.value === null ? null : Math.max(r.growth.value, 0), 1)} growth) × {BASE_YIELD} ÷ {fmt(r.aaa)}% AAA
              {r.growth.value !== null && r.growth.value < 0 && <span className="block text-neutral-500">Earnings are shrinking, so growth counts as 0.</span>}
              {r.fair !== null && <span className="text-neutral-500"> = {currency(r.fair)}</span>}
            </div>
            <dl className="mt-2 grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5">
              <dt className="text-neutral-400">
                EPS, last 12 months
                {r.eps.edited ? (
                  <span className="block text-xs text-neutral-600">
                    your number · automatic {fmt(r.eps.auto)} <ResetLink onClick={() => reset('eps', 'EPS')} />
                  </span>
                ) : (
                  r.eps.foreign && (
                    <span className="block text-xs text-neutral-600">
                      reports in {r.eps.foreign.currency}, so price ÷ P/E {fmt(r.eps.foreign.pe, 1)}
                    </span>
                  )
                )}
              </dt>
              <dd className="text-right tabular-nums text-neutral-100">
                {fmt(r.eps.value)} {r.eps.edited && <Pill tone="violet">edited</Pill>}
              </dd>
              <dd>
                <IconButton title="Edit EPS" onClick={() => override('eps', `EPS · ${r.symbol}`, 'EPS (last 12 months)', r.eps.value, r.eps.auto, 'Earnings per share over the last 12 months.')} />
              </dd>
              <dt className="text-neutral-400">
                Growth used
                <span className="block text-xs text-neutral-600">
                  {r.growth.edited ? (
                    <>
                      your number · automatic {r.growth.auto !== null ? `${fmt(r.growth.auto, 1)}%` : '—'} <ResetLink onClick={() => reset('growth', 'growth')} />
                    </>
                  ) : r.growth.from === 'forecast' && r.growth.forecast
                      ? `analysts' forecast${r.growth.forecast.fromYear && r.growth.forecast.toYear ? `, ${r.growth.forecast.fromYear}–${r.growth.forecast.toYear}` : ''}${r.growth.forecast.analysts ? ` (${r.growth.forecast.analysts} analysts)` : ''}${r.growth.capped ? `, capped at ${settings.growthCap}%` : ''}`
                      : `no forecast · past 5y ${fmt(r.growth.raw5y, 1)}% · 3y ${fmt(r.growth.raw3y, 1)}% → lower one${r.growth.capped ? `, capped at ${settings.growthCap}%` : ''}`
                  }
                </span>
              </dt>
              <dd className="text-right tabular-nums text-neutral-100">
                {r.growth.value !== null ? `${fmt(r.growth.value, 1)}%` : '—'} {r.growth.edited && <Pill tone="violet">edited</Pill>}
              </dd>
              <dd>
                <IconButton title="Edit growth" onClick={() => override('growth', `Growth · ${r.symbol}`, 'Growth % per year', r.growth.value, r.growth.auto, 'Expected yearly EPS growth over the next 5 years. Be conservative.')} />
              </dd>
              <dt className="text-neutral-400">
                AAA bond yield
                <span className="block text-xs text-neutral-600">{macro.aaaAsOf ? `FRED, ${dateFmt(macro.aaaAsOf)}` : 'default until the first daily run'}</span>
              </dt>
              <dd className="text-right tabular-nums text-neutral-100">{fmt(r.aaa)}%</dd>
              <dd />
              <dt className="text-neutral-400">Buy below (85% of fair value)</dt>
              <dd className="text-right font-medium tabular-nums text-emerald-300">{r.buyBelow !== null ? currency(r.buyBelow) : '—'}</dd>
              <dd />
            </dl>
          </section>

          {/* Score */}
          <section>
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Score</h3>
              <span className="text-lg font-semibold tabular-nums text-white">
                {r.total ?? '—'}
                <span className="text-sm font-normal text-neutral-500"> / 100</span>
              </span>
            </div>
            <ul className="mt-2 flex flex-col gap-2.5">
              {r.parts.map((p) => (
                <li key={p.key}>
                  <div className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-neutral-300">{p.label}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
                      <span className={`block h-full rounded-full ${PART_BAR[partTone(p)]}`} style={{ width: `${((p.points ?? 0) / p.max) * 100}%` }} />
                    </span>
                    <span className="w-12 text-right tabular-nums text-neutral-100">
                      {p.points ?? '—'}
                      <span className="text-neutral-600">/{p.max}</span>
                    </span>
                    <IconButton title={`Edit ${p.label.toLowerCase()}`} onClick={() => editPart(p)} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 pl-23 text-xs text-neutral-500">
                    {p.detail}
                    {p.edited && (
                      <>
                        <Pill tone="violet">edited</Pill>
                        <span>automatic {p.auto ?? '—'}</span>
                        <button
                          className="inline-flex items-center gap-1 text-neutral-400 hover:text-white"
                          title="Back to automatic"
                          onClick={() =>
                            p.key === 'economy'
                              ? user && save(setResearchSettings(user.id, { economy_override: null }), 'Economy score back to automatic')
                              : user && save(setResearchOverride(user.id, r.symbol, p.key as ResearchOverrideField, null), `${p.label} back to automatic`)
                          }
                        >
                          <RotateCcw size={11} /> Reset
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {r.partial && <p className="mt-2 text-xs text-neutral-500">Partial: some parts have no data yet, so the total covers what's available.</p>}
          </section>

          {/* Earnings */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Next earnings</h3>
            <p className="mt-1.5 text-neutral-200">
              {r.earnings ? (
                <>
                  {dateFmt(r.earnings.date)}
                  {r.earnings.hour === 'amc' ? ' after close' : r.earnings.hour === 'bmo' ? ' before open' : ''} · in {r.earnings.days} day{r.earnings.days === 1 ? '' : 's'}
                  {r.earnings.estimate !== null && <span className="text-neutral-500"> · expected EPS {fmt(r.earnings.estimate)}</span>}
                </>
              ) : (
                <span className="text-neutral-500">No date in the next 4 months.</span>
              )}
            </p>
          </section>

          {/* How it's calculated */}
          <section className="rounded-xl border border-(--border)">
            <button className="flex w-full items-center justify-between px-3 py-2.5 text-left text-neutral-200" onClick={() => setShowHow((v) => !v)}>
              How this is calculated
              <ChevronDown size={15} className={`transition ${showHow ? 'rotate-180' : ''}`} />
            </button>
            {showHow && (
              <div className="flex flex-col gap-4 border-t border-(--border) px-3 py-3 text-xs text-neutral-400">
                <div>
                  <p className="font-medium text-neutral-200">Fair value: Graham's revised formula</p>
                  <p className="mt-1 font-mono text-neutral-300">EPS × (7 + growth) × 4.4 ÷ AAA yield</p>
                  <ul className="mt-1 list-disc pl-4">
                    <li>7 = the P/E a company with no growth deserves.</li>
                    <li>Growth = analysts' forecast EPS growth per year, from next fiscal year to up to 5 years out. Without a forecast, the lower of past 5-year and 3-year EPS growth. Capped at {settings.growthCap}% <button className="text-(--accent-text) hover:underline" onClick={editGrowthCap}>change</button>.</li>
                    <li>4.4 = the AAA yield when the formula was written; today's AAA yield comes from FRED daily. Higher rates mean a lower fair value.</li>
                    <li>Buy below = 85% of fair value (a 15% margin of safety).</li>
                  </ul>
                </div>
                <Rules title="Valuation (20): price vs fair value" rows={VALUATION_TABLE.map(([from, p], i) => [i === 0 ? `under ${Math.round(VALUATION_TABLE[1][0] * 100)}%` : `${Math.round(from * 100)}%+`, p])} />
                <Rules title="Growth (20): growth per year" rows={[...GROWTH_TABLE.map(([from, p]) => [`${from}%+`, p] as [string, number]), ['shrinking', 4]]} />
                <Rules title="Moat (20): gross margin + return on equity" rows={[...GROSS_MARGIN_TABLE.map(([from, p]) => [`margin ${from}%+`, p] as [string, number]), ['margin below 10%', 2], ...ROE_TABLE.map(([from, p]) => [`ROE ${from}%+`, p] as [string, number]), ['ROE below 5%', 2]]} note="Banks have no gross margin, so return on equity counts twice." />
                <div>
                  <p className="font-medium text-neutral-200">Execution risk (10, higher = safer)</p>
                  <p className="mt-1">Profitable 4 · debt/equity under 0.5 = 3, up to 1.5 = 2, above = 0 · current ratio 1.5+ = 3, 1–1.5 = 2, under 1 = 0.</p>
                </div>
                <div>
                  <p className="font-medium text-neutral-200">Economy (30, same for every stock)</p>
                  <p className="mt-1">
                    Starts at 30. Unemployment up from its 12-month low: 0.5+ pts −10, 0.3–0.5 −5, 0.1–0.3 −2. 10-year Treasury: over 5.5% −8, 5–5.5% −5, 4.5–5% −3.
                  </p>
                  <p className="mt-1 text-neutral-300">
                    Now: unemployment {fmt(macro.unemployment, 1)}% (12-month low {fmt(macro.unemploymentLow, 1)}%, up {fmt(econ.rise, 1)}) → −{econ.jobsPenalty}; 10-year {fmt(macro.t10)}% → −{econ.ratesPenalty}.
                  </p>
                </div>
                <p>Labels: 80+ Strong · 70–79 Good · 60–69 Fair · under 60 Weak. An estimate from public data — not advice.</p>
              </div>
            )}
          </section>

          {onRemove && (
            <Button variant="ghost" icon={<Trash2 size={14} />} onClick={onRemove} className="self-start text-neutral-400">
              Remove from watchlist
            </Button>
          )}
        </div>
      )}
    </Drawer>
  )
}

const showValue = (field: ResearchOverrideField, v: number | null) =>
  v === null ? '—' : field === 'eps' ? `$${fmt(v)}` : field === 'growth' ? `${fmt(v, 1)}%` : `${v} pts`

function ResetLink({ onClick }: { onClick: () => void }) {
  return (
    <button className="inline-flex items-center gap-1 text-neutral-400 hover:text-white" title="Back to automatic" onClick={onClick}>
      <RotateCcw size={11} /> Reset
    </button>
  )
}

function IconButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} className="rounded-md p-1 text-neutral-600 transition hover:bg-(--card-raised) hover:text-white">
      <Pencil size={12} />
    </button>
  )
}

function Rules({ title, rows, note }: { title: string; rows: [string, number][]; note?: string }) {
  return (
    <div>
      <p className="font-medium text-neutral-200">{title}</p>
      <div className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">
        {rows.map(([k, p]) => (
          <span key={k} className="flex justify-between tabular-nums">
            <span>{k}</span>
            <span className="text-neutral-200">{p}</span>
          </span>
        ))}
      </div>
      {note && <p className="mt-1">{note}</p>}
    </div>
  )
}
