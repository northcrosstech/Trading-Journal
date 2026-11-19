import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import type { InstallmentPayment, NetworthAccount, NetworthBalance, Portfolio, PortfolioDailyValue } from '../lib/database.types'
import { fetchIncomeEntries } from '../lib/wealthQueries'
import { incomeIn, type MonthIncome } from '../lib/income'
import { bestAndWorst, monthRecap, type RecapFlow } from '../lib/monthRecap'
import { monthLabel } from '../lib/networth'
import { centralDateStr, currency, dateFmt } from '../lib/format'
import { signedCurrency as signed } from '../lib/portfolio'
import { toneClass } from '../lib/ui'
import { Drawer } from './ui/Drawer'

const HEADING = 'text-[11px] font-medium uppercase tracking-wide text-neutral-500'
const list = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`)

/** A label on the left, an amount on the right, and an optional short hint underneath. */
function Line({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-neutral-200">{label}</span>
        <span className="shrink-0 tabular-nums">{children}</span>
      </div>
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
    </div>
  )
}

function Section({ title, total, children }: { title: string; total?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-t border-(--border) pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={HEADING}>{title}</h3>
        {total !== undefined && <span className="text-sm font-semibold tabular-nums text-neutral-100">{total}</span>}
      </div>
      {children}
    </section>
  )
}

type RecapData = {
  accounts: NetworthAccount[]
  balances: NetworthBalance[]
  portfolios: Portfolio[]
  dailyValues: PortfolioDailyValue[]
  payments: InstallmentPayment[]
  /** Portfolio deposits and withdrawals; null while they load. */
  flows: RecapFlow[] | null
  flowsError: string | null
}

function RecapBody({ month, accounts, balances, portfolios, dailyValues, payments, flows, flowsError, onCashFlow }: RecapData & { month: string; onCashFlow: (month: string) => void }) {
  // Dividends and option premium for the month; null while loading, 'failed' when the read fails.
  const [income, setIncome] = useState<MonthIncome | 'failed' | null>(null)
  useEffect(() => {
    let live = true
    fetchIncomeEntries(month)
      .then((entries) => live && setIncome(incomeIn(entries, month)))
      .catch(() => live && setIncome('failed'))
    return () => {
      live = false
    }
  }, [month])

  // Without the flows the net worth figures still stand; the split and portfolio growth don't.
  const recap = useMemo(() => monthRecap(month, accounts, balances, portfolios, dailyValues, flows ?? [], payments), [month, accounts, balances, portfolios, dailyValues, flows, payments])
  const cf = recap.cashFlow
  const ranked = flows !== null && recap.growth ? bestAndWorst(recap.growth) : null

  const split = [
    { label: 'Cash saved', hint: 'change in cash + emergency fund', value: cf.cashSaved },
    { label: 'Invested', hint: 'deposits into portfolios', value: cf.invested },
    { label: 'Debt paid down', hint: cf.debtPaidDown < 0 ? 'debt grew this month' : 'loans and cards', value: cf.debtPaidDown },
    { label: 'Investment growth', hint: 'portfolio gains, not money you added', value: cf.investmentGrowth },
    { label: 'Other changes', hint: 'home / car values, manual retirement accounts, new accounts', value: cf.otherChanges },
  ].filter((r) => Math.abs(r.value) >= 0.005)

  const change = cf.netWorthChange
  const verb = change > 0 ? 'rose' : 'fell'

  return (
    <div className="flex flex-col gap-4">
      <div>
        {!recap.hasPrevious ? (
          <>
            <div className={HEADING}>First month recorded</div>
            <p className="mt-1 text-lg font-semibold text-white">
              Net worth <span className="tabular-nums">{currency(recap.netWorth)}</span>
            </p>
          </>
        ) : (
          <p className="text-lg font-semibold leading-snug text-white">
            {Math.abs(change) < 0.005 ? (
              'Net worth held at '
            ) : (
              <>
                Net worth {verb} <span className={`tabular-nums ${toneClass(change)}`}>{currency(Math.abs(change))}</span> to{' '}
              </>
            )}
            <span className="tabular-nums">{currency(recap.netWorth)}</span>
          </p>
        )}
      </div>

      {recap.hasPrevious &&
        (flowsError ? (
          <p className="text-sm text-neutral-400">The breakdown of this change couldn’t be loaded.</p>
        ) : flows === null ? (
          <p className="text-sm text-neutral-500">Loading the breakdown…</p>
        ) : (
          split.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {split.map((r) => (
                <Line key={r.label} label={r.label} hint={r.hint}>
                  <span className={`font-semibold ${toneClass(r.value)}`}>{signed(r.value)}</span>
                </Line>
              ))}
              {!cf.complete && (
                <p className="text-xs text-amber-300/90">
                  Estimated: {list(cf.carried)} {cf.carried.length === 1 ? 'uses a balance' : 'use balances'} carried from an earlier month, so part of the change may be missing.
                </p>
              )}
            </div>
          )
        ))}

      {ranked && (
        <Section title={ranked.worst ? 'Investment growth · best and worst portfolio' : 'Investment growth by portfolio'}>
          <Line label={ranked.worst ? <><span className="text-neutral-500">Best · </span>{ranked.best.name}</> : ranked.best.name}>
            <span className={toneClass(ranked.best.growth)}>{signed(ranked.best.growth)}</span>
          </Line>
          {ranked.worst && (
            <Line label={<><span className="text-neutral-500">Worst · </span>{ranked.worst.name}</>}>
              <span className={toneClass(ranked.worst.growth)}>{signed(ranked.worst.growth)}</span>
            </Line>
          )}
        </Section>
      )}

      {income === 'failed' ? (
        <Section title="Income received">
          <p className="text-sm text-neutral-400">Dividends and option premium couldn’t be loaded.</p>
        </Section>
      ) : (
        income !== null &&
        (income.dividends !== 0 || income.premium !== 0) && (
          <Section title="Income received" total={currency(income.total)}>
            <Line label="Dividends">
              <span className="text-neutral-300">{currency(income.dividends)}</span>
            </Line>
            <Line label={<>Option premium<span className="text-neutral-500"> · after buy-backs</span></>}>
              <span className="text-neutral-300">{currency(income.premium)}</span>
            </Line>
          </Section>
        )
      )}

      {recap.payments.length > 0 && (
        <Section title={`Payments made · ${recap.payments.length}`} total={currency(recap.paymentsTotal)}>
          {recap.payments.length <= 6 &&
            recap.payments.map((p) => (
              <Line key={p.accountId} label={p.name}>
                <span className="text-neutral-300">{currency(p.amount)}</span>
              </Line>
            ))}
        </Section>
      )}

      <div className="border-t border-(--border) pt-3">
        <button onClick={() => onCashFlow(month)} className="inline-flex items-center gap-1.5 text-sm font-medium text-(--accent-text) transition hover:brightness-125">
          See {monthLabel(month)} in Cash flow <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

/** One closed month on one screen: how net worth changed and why, the best and worst portfolio,
 * income received and payments made. Opens by itself after a close and from "Recap" on a
 * closed month; Esc, the X or a click outside closes it. `month` null = not showing. */
export function MonthRecap({
  month,
  closedAt,
  onClose,
  onCashFlow,
  ...data
}: RecapData & {
  month: string | null
  /** When the month was closed, for the subtitle. */
  closedAt: string | null
  onClose: () => void
  /** Opens the Cash flow tab on that month. */
  onCashFlow: (month: string) => void
}) {
  return (
    <Drawer
      open={month !== null}
      onClose={onClose}
      title={month ? `${monthLabel(month)} recap` : ''}
      subtitle={closedAt ? `Closed ${dateFmt(centralDateStr(new Date(closedAt)))}` : undefined}
    >
      {/* A new key per month: the income read starts clean for each one. */}
      {month && <RecapBody key={month} month={month} onCashFlow={onCashFlow} {...data} />}
    </Drawer>
  )
}
