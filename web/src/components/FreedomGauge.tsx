import { useEffect, useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { NetworthAccount, NetworthBalance, Portfolio, PortfolioActivity, PortfolioDailyValue } from '../lib/database.types'
import { fetchExternalFlows, fetchFreedomSettings, saveFreedomSettings } from '../lib/wealthQueries'
import { FREEDOM_DEFAULTS, freedomHistory, freedomSummary, suggestSavings, suggestSpending, type FreedomSettings } from '../lib/freedom'
import { addMonths, monthLabel, monthTotals, type NetworthLine } from '../lib/networth'
import { INPUT_SM } from '../lib/ui'
import { useToast } from '../lib/toastContext'
import { FreedomHistoryChart } from './WealthCharts'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'
import { Drawer } from './ui/Drawer'

const whole = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const sectionTitle = 'mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500'

function timeText(months: number | null, today: string): string {
  if (months === null) return 'Not reached at this pace'
  if (months === 0) return 'You’re there'
  const year = Number(today.slice(0, 4)) + Math.floor((Number(today.slice(5, 7)) - 1 + months) / 12)
  if (months < 12) return `About ${months} month${months === 1 ? '' : 's'} away (${year})`
  const years = Math.round(months / 12)
  return `About ${years} year${years === 1 ? '' : 's'} away (${year})`
}

/** A half-circle dial, with marks at 25, 50 and 75%. */
function Dial({ progress }: { progress: number }) {
  const shown = Math.min(progress, 1) * 100
  const arc = 'M 12 92 A 78 78 0 0 1 168 92'
  return (
    <svg viewBox="0 0 180 104" className="w-full max-w-64" role="img" aria-label={`${Math.round(progress * 100)}% of the way to financial freedom`}>
      <path d={arc} fill="none" stroke="var(--gridline)" strokeWidth="12" strokeLinecap="round" />
      {shown > 0 && <path d={arc} fill="none" stroke="var(--series-1)" strokeWidth="12" strokeLinecap="round" pathLength={100} strokeDasharray={`${shown} 100`} />}
      {[25, 50, 75].map((m) => {
        const a = Math.PI * (1 - m / 100)
        return <line key={m} x1={90 + 69 * Math.cos(a)} y1={92 - 69 * Math.sin(a)} x2={90 + 64 * Math.cos(a)} y2={92 - 64 * Math.sin(a)} stroke="var(--text-muted)" strokeWidth="1.5" />
      })}
      <text x="90" y="82" textAnchor="middle" fill="white" fontSize="30" fontWeight="600">
        {Math.round(progress * 100)}%
      </text>
    </svg>
  )
}

function Lines({ lines, title }: { lines: NetworthLine[]; title: string }) {
  if (lines.length === 0) return null
  return (
    <section>
      <h3 className={sectionTitle}>{title}</h3>
      <ul className="flex flex-col gap-1">
        {lines.map((l) => (
          <li key={l.key} className="flex justify-between gap-3 tabular-nums">
            <span className="truncate text-neutral-300">{l.name}</span>
            <span className={l.amount < 0 ? 'text-red-300' : 'text-neutral-100'}>{whole(l.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NumberField({ label, hint, value, onChange, placeholder, prefix, suffix }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; prefix?: string; suffix?: string }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="text-neutral-200">{label}</span>
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </span>
      <span className="relative w-28 shrink-0">
        {prefix && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">{prefix}</span>}
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={placeholder} aria-label={label} className={`${INPUT_SM} text-right tabular-nums ${prefix ? 'pl-5' : ''} ${suffix ? 'pr-6' : ''}`} />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">{suffix}</span>}
      </span>
    </label>
  )
}

/** Towards financial freedom: how much of the money you need to stop depending on a paycheck
 * you already have. Day trading plays no part in it. */
export function FreedomGauge({
  today,
  month,
  accounts,
  balances,
  portfolios,
  values,
}: {
  today: string
  month: string
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  portfolios: Portfolio[]
  values: PortfolioDailyValue[]
}) {
  const { user } = useAuth()
  const toast = useToast()
  const [settings, setSettings] = useState<FreedomSettings>(FREEDOM_DEFAULTS)
  const [flows, setFlows] = useState<Pick<PortfolioActivity, 'portfolio_id' | 'kind' | 'external_flow' | 'occurred_on'>[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ spending: '', otherBills: '', savings: '', rate: '', growth: '', coast: '' })

  useEffect(() => {
    fetchFreedomSettings()
      .then(setSettings)
      .catch(() => {})
    fetchExternalFlows()
      .then(setFlows)
      .catch(() => {})
  }, [])

  const lines = useMemo(() => monthTotals(month, accounts, balances, portfolios, values).lines, [month, accounts, balances, portfolios, values])
  const prevLines = useMemo(() => monthTotals(addMonths(month, -1), accounts, balances, portfolios, values).lines, [month, accounts, balances, portfolios, values])
  const spendingIdea = useMemo(() => suggestSpending(accounts, balances, month, settings.otherBills), [accounts, balances, month, settings.otherBills])
  const savingsIdea = useMemo(() => suggestSavings(month, accounts, balances, portfolios, values, flows), [month, accounts, balances, portfolios, values, flows])
  const spending = settings.monthlySpending ?? spendingIdea.total
  const savings = settings.monthlySavings ?? savingsIdea.monthly
  const f = useMemo(() => freedomSummary(lines, spending, savings, settings), [lines, spending, savings, settings])
  const before = useMemo(() => (prevLines.length > 0 ? freedomSummary(prevLines, spending, savings, settings).progress : null), [prevLines, spending, savings, settings])
  const history = useMemo(() => freedomHistory(month, accounts, balances, portfolios, values, spending, settings.withdrawalRate), [month, accounts, balances, portfolios, values, spending, settings.withdrawalRate])

  function openDetails() {
    setForm({
      spending: settings.monthlySpending !== null ? String(settings.monthlySpending) : '',
      otherBills: settings.otherBills ? String(settings.otherBills) : '',
      savings: settings.monthlySavings !== null ? String(settings.monthlySavings) : '',
      rate: String(settings.withdrawalRate),
      growth: String(settings.realReturn),
      coast: String(settings.coastYears),
    })
    setOpen(true)
  }

  const blankOr = (s: string) => (s.trim() === '' ? null : Number(s))
  const next: FreedomSettings = {
    monthlySpending: blankOr(form.spending),
    otherBills: Number(form.otherBills) || 0,
    monthlySavings: blankOr(form.savings),
    withdrawalRate: Number(form.rate),
    realReturn: Number(form.growth),
    coastYears: Math.round(Number(form.coast)),
  }
  const valid =
    Object.values(next).every((v) => v === null || Number.isFinite(v)) &&
    form.rate.trim() !== '' &&
    form.growth.trim() !== '' &&
    form.coast.trim() !== '' &&
    next.withdrawalRate >= 1 &&
    next.withdrawalRate <= 10 &&
    next.realReturn <= 15 &&
    next.coastYears <= 60
  const formIdea = suggestSpending(accounts, balances, month, Number(form.otherBills) || 0)

  async function save() {
    if (!user || !valid) return
    setSaving(true)
    try {
      await saveFreedomSettings(user.id, next)
      setSettings(next)
      toast('Saved')
      setOpen(false)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const change = f.progress !== null && before !== null ? (f.progress - before) * 100 : null
  const milestones = [
    { label: 'Coast', detail: `${whole(f.coastNumber)}: growth alone gets you there in ${settings.coastYears} years`, done: f.money.money >= f.coastNumber },
    ...[25, 50, 75, 100].map((p) => ({ label: `${p}%`, detail: whole((f.target * p) / 100), done: f.progress !== null && f.progress >= p / 100 })),
  ]

  return (
    <Card
      title="Towards financial freedom"
      actions={
        <Button size="sm" icon={<Settings2 size={14} />} onClick={openDetails}>
          Details
        </Button>
      }
    >
      {f.progress === null ? (
        <p className="text-sm text-neutral-400">
          Tell the gauge what you spend each month to see how close you are.{' '}
          <button type="button" onClick={openDetails} className="text-(--accent-text) hover:underline">
            Enter your spending
          </button>
        </p>
      ) : (
        <div className="flex flex-col items-center gap-x-8 gap-y-3 sm:flex-row">
          <div className="flex w-full justify-center sm:w-64 sm:shrink-0">
            <Dial progress={f.progress} />
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1.5 text-sm">
            <p className="text-lg font-semibold tabular-nums text-white">
              {whole(f.money.money)} <span className="text-sm font-normal text-neutral-400">of {whole(f.target)}, before taxes</span>
            </p>
            <p className="tabular-nums text-neutral-300">
              Could pay {whole(f.monthlyIncome)}/mo of your {whole(spending)}/mo{f.money.mortgage > 0 ? ', after clearing the mortgage' : ''}
            </p>
            <p className="tabular-nums text-neutral-300">
              {timeText(f.months, today)}
              {f.months !== 0 && f.months !== null && <span className="text-neutral-500"> · saving {whole(savings)}/mo</span>}
              {change !== null && <span className="text-neutral-500"> · {change >= 0 ? 'up' : 'down'} {Math.abs(change).toFixed(1)} points this month</span>}
            </p>
            <p className="text-xs text-neutral-500">Spending $500 less a month lowers your target by {whole(f.per500)}.</p>
          </div>
        </div>
      )}

      <Drawer open={open} onClose={() => setOpen(false)} title="Towards financial freedom" subtitle="Your inputs, and how the numbers are worked out." width="max-w-lg">
        <div className="flex flex-col gap-6 text-sm">
          <section className="flex flex-col gap-3">
            <h3 className={sectionTitle}>Spending</h3>
            <div className="rounded-xl bg-(--card-raised) px-3 py-2.5 text-xs tabular-nums text-neutral-300">
              <p className="flex justify-between"><span>Cards (average month-end balance, 12 months)</span><span>{whole(formIdea.cards)}</span></p>
              <p className="flex justify-between"><span>Property tax + insurance (escrow)</span><span>{whole(formIdea.escrow)}</span></p>
              <p className="flex justify-between"><span>Other bills</span><span>{whole(formIdea.otherBills)}</span></p>
              <p className="mt-1 flex justify-between border-t border-(--border) pt-1 font-semibold text-neutral-100"><span>Suggested</span><span>{whole(formIdea.total)}</span></p>
              {formIdea.notes.map((n) => (
                <p key={n} className="mt-1 text-amber-300">{n}</p>
              ))}
            </div>
            <NumberField label="Other bills per month" hint="Anything not on cards: utilities, upkeep, a car budget." prefix="$" value={form.otherBills} onChange={(v) => setForm((x) => ({ ...x, otherBills: v }))} placeholder="0" />
            <NumberField label="My spending per month" hint="Leave blank to use the suggestion. Leave out loan and mortgage payments." prefix="$" value={form.spending} onChange={(v) => setForm((x) => ({ ...x, spending: v }))} placeholder={String(Math.round(formIdea.total))} />
          </section>

          <section className="flex flex-col gap-3">
            <h3 className={sectionTitle}>Assumptions</h3>
            <NumberField
              label="My savings per month"
              hint={`Leave blank to use the suggestion: ${whole(savingsIdea.monthly)}, your average kept${savingsIdea.months > 0 ? ` over ${savingsIdea.months} month${savingsIdea.months === 1 ? '' : 's'}` : ''}. Add 401k contributions if they aren't logged in a portfolio.`}
              prefix="$"
              value={form.savings}
              onChange={(v) => setForm((x) => ({ ...x, savings: v }))}
              placeholder={String(Math.round(savingsIdea.monthly))}
            />
            <NumberField label="Yearly withdrawal" hint="4% means a target of 25 × yearly spending. Between 1% and 10%." suffix="%" value={form.rate} onChange={(v) => setForm((x) => ({ ...x, rate: v }))} />
            <NumberField label="Yearly growth after inflation" hint="An estimate, not a promise. Up to 15%." suffix="%" value={form.growth} onChange={(v) => setForm((x) => ({ ...x, growth: v }))} />
            <NumberField label="Years until you’d stop working at the latest" hint="Used only for the Coast milestone." value={form.coast} onChange={(v) => setForm((x) => ({ ...x, coast: v.replace('.', '') }))} />
            <div className="flex justify-end">
              <Button variant="primary" onClick={save} disabled={!valid || saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </section>

          {f.progress !== null && (
            <>
              <section>
                <h3 className={sectionTitle}>Your target</h3>
                <div className="flex flex-col gap-1 tabular-nums text-neutral-300">
                  <p className="flex justify-between gap-3"><span>{whole(spending)}/mo × 12 ÷ {settings.withdrawalRate}%</span><span>{whole(f.target - f.money.mortgage)}</span></p>
                  <p className="flex justify-between gap-3"><span>Mortgage to clear</span><span>{whole(f.money.mortgage)}</span></p>
                  <p className="flex justify-between gap-3 border-t border-(--border) pt-1 font-semibold text-white"><span>Freedom number</span><span>{whole(f.target)}</span></p>
                </div>
              </section>

              <Lines title="Counted" lines={f.money.counted} />
              <Lines title="Subtracted" lines={f.money.subtracted} />
              <Lines title="Left out" lines={f.money.left} />

              <section>
                <h3 className={sectionTitle}>Milestones</h3>
                <ul className="flex flex-col gap-1.5">
                  {milestones.map((m) => (
                    <li key={m.label} className="flex items-center justify-between gap-3">
                      <span className="text-neutral-300">
                        <span className="font-medium text-neutral-100">{m.label}</span> · <span className="tabular-nums">{m.detail}</span>
                      </span>
                      {m.done && <Pill tone="green">reached</Pill>}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className={sectionTitle}>Progress by month</h3>
                <FreedomHistoryChart data={history.map((p) => ({ ...p, label: monthLabel(p.month) }))} />
                <p className="mt-1 text-xs text-neutral-500">Past months use today’s spending, so the line shows your money and mortgage changing, not your spending.</p>
              </section>
            </>
          )}
        </div>
      </Drawer>
    </Card>
  )
}
