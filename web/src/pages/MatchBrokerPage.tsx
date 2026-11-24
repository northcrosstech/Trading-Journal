import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Pill } from '../components/ui/Pill'
import { PageError, PageLoading } from '../components/ui/PageState'
import { useToast } from '../lib/toastContext'
import { centralDateStr, currency } from '../lib/format'
import { INPUT_SM } from '../lib/ui'
import type { Portfolio } from '../lib/database.types'
import {
  fetchCsps,
  fetchHoldings,
  fetchLatestPrices,
  fetchOptions,
  fetchPortfolios,
  cspOpen,
  cspResolve,
  optionClose,
  optionOpen,
  portfolioSetCash,
  portfolioTrades,
  type TradeLine,
} from '../lib/wealthQueries'
import {
  SHEET_HEADERS,
  answered,
  buildPlan,
  countEntries,
  lineKey,
  outcomeChoices,
  readSheet,
  snapshotRows,
  type CloseAnswer,
  type MatchPlan,
  type OptionLine,
  type PortfolioPlan,
  type SheetRow,
  type Snapshot,
  type StockLine,
} from '../lib/brokerMatch'
import { downloadSheet, readSheetFile } from '../lib/brokerSheet'

type Data = { portfolios: Portfolio[]; snaps: Map<string, Snapshot> }

async function loadData(): Promise<Data> {
  const [portfolios, holdings, options, csps] = await Promise.all([fetchPortfolios(), fetchHoldings(), fetchOptions(), fetchCsps()])
  const snaps = new Map<string, Snapshot>()
  for (const p of portfolios) {
    snaps.set(p.id, {
      portfolio: p,
      holdings: holdings.filter((h) => h.portfolio_id === p.id),
      options: options.filter((o) => o.portfolio_id === p.id && o.status === 'open'),
      csps: csps.filter((c) => c.portfolio_id === p.id && c.status === 'open'),
    })
  }
  return { portfolios, snaps }
}

async function loadCloses(data: Data, rows: SheetRow[]): Promise<Map<string, number>> {
  const symbols = new Set<string>()
  for (const s of data.snaps.values()) for (const h of s.holdings) symbols.add(h.symbol)
  for (const r of rows) if (r.ticker && r.ticker !== 'CASH') symbols.add(r.ticker)
  const prices = await fetchLatestPrices([...symbols])
  return new Map([...prices].map(([s, p]) => [s, p.close]))
}

const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 })
const price = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const optionName = (o: OptionLine) => `${o.group.symbol} ${qty(o.group.strike)} ${o.group.type === 'call' ? 'call' : 'put'} · ${o.group.expiration} · ${o.group.side === 'long' ? 'bought' : 'sold'}`

/**
 * Match my broker: download what the app holds as a spreadsheet, change it to what the
 * broker shows, upload it, review, Log all. Every save goes through the same portfolio
 * functions as the regular forms, so the maths, Activity, Undo and the health check are
 * unchanged. Only portfolios named in the file are touched.
 */
export function MatchBrokerPage() {
  const toast = useToast()
  const [params] = useSearchParams()
  const only = params.get('p')
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<SheetRow[] | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [closes, setCloses] = useState<Map<string, number>>(new Map())
  const [answers, setAnswers] = useState<Map<string, CloseAnswer>>(new Map())
  const [sellPrices, setSellPrices] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const today = centralDateStr(new Date())

  const load = useCallback(() => {
    setLoadError(null)
    loadData()
      .then((d) => {
        setData(d)
        setPicked((prev) => (prev.size ? prev : new Set(d.portfolios.filter((p) => !p.archived && (!only || p.id === only)).map((p) => p.id))))
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [only])
  useEffect(load, [load])

  const active = useMemo(() => data?.portfolios.filter((p) => !p.archived) ?? [], [data])
  const plan: MatchPlan | null = useMemo(() => (data && rows ? buildPlan(rows, data.portfolios, data.snaps, closes, today, answers) : null), [data, rows, closes, today, answers])
  // An option past its expiry that left the broker most likely expired: answer that for the person.
  const effective = useMemo(() => {
    const out = new Map(answers)
    for (const p of plan?.plans ?? [])
      for (const o of p.options) {
        const k = lineKey(p.portfolio.id, o.key)
        if (o.status === 'ask' && o.group.expiration < today && !out.has(k)) out.set(k, { outcome: 'expired', price: null })
      }
    return out
  }, [plan, answers, today])
  const counts = plan ? countEntries(plan, effective) : null
  const back = only && data?.portfolios.find((p) => p.id === only)

  async function download() {
    if (!data) return
    const snaps = active.filter((p) => picked.has(p.id)).map((p) => data.snaps.get(p.id)!)
    await downloadSheet(snapshotRows(snaps), `positions-${today}.xlsx`)
  }

  async function onFile(file: File | undefined) {
    if (!file || !data) return
    setFileName(file.name)
    setFileError(null)
    setSaveResult(null)
    setAnswers(new Map())
    setSellPrices(new Map())
    try {
      const parsed = readSheet(await readSheetFile(file))
      if (parsed.missingColumns.length) {
        setRows(null)
        setFileError(`This file has no ${parsed.missingColumns.join(', ')} column. The first row needs the column names: ${SHEET_HEADERS.join(', ')}.`)
        return
      }
      if (!parsed.rows.length) {
        setRows(null)
        setFileError('This file has column names but no rows.')
        return
      }
      setCloses(await loadCloses(data, parsed.rows))
      setRows(parsed.rows)
    } catch (e) {
      setRows(null)
      setFileError(`Couldn't read this file (${e instanceof Error ? e.message : String(e)}). Save it as .xlsx or .csv and try again.`)
    }
  }

  function sellPrice(pid: string, s: StockLine): number | null {
    const typed = sellPrices.get(lineKey(pid, s.symbol))
    if (typed == null || typed.trim() === '') return s.price ?? null
    const n = Number(typed.replace(/[$,]/g, ''))
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  async function logAll() {
    if (!data || !rows || !plan) return
    setSaving(true)
    setSaveResult(null)
    let saved = 0
    let current = ''
    try {
      for (const p of plan.plans) {
        if (p.blocked) continue
        current = p.portfolio.name
        const pid = p.portfolio.id

        // 1. Options that left the broker, the way the person said they ended
        for (const o of p.options) {
          const a = effective.get(lineKey(pid, o.key))
          if (o.status !== 'ask' || !o.close || !answered(a)) continue
          const lots = o.close.partial ? o.close.lots.slice(0, 1) : o.close.lots
          for (const lot of lots) {
            const contracts = o.close.partial ? o.close.contracts : undefined
            if (lot.isCsp) await cspResolve({ cspId: lot.id, outcome: a!.outcome === 'exercised' ? 'closed' : (a!.outcome as 'closed' | 'expired' | 'assigned'), price: a!.price, on: today, contracts })
            else await optionClose({ optionId: lot.id, outcome: a!.outcome, price: a!.price, on: today, contracts })
            saved++
          }
        }

        // 2. Shares, worked out again from what the app holds now
        let fresh = await loadData()
        let pp = buildPlan(rows, fresh.portfolios, fresh.snaps, closes, today).plans.find((x) => x.portfolio.id === pid)
        const trades: TradeLine[] = []
        for (const s of pp?.stocks ?? []) {
          if (s.status !== 'log' || !s.side || !s.quantity) continue
          const px = s.side === 'sell' ? sellPrice(pid, s) : s.price
          if (px == null) throw new Error(`${s.symbol}: enter a sale price`)
          trades.push({ symbol: s.symbol, side: s.side, quantity: s.quantity, price: px, fee: 0, on: today })
        }
        trades.sort((a, b) => (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1))
        if (trades.length) {
          await portfolioTrades(pid, trades)
          saved += trades.length
        }

        // 3. New option contracts (after the shares, so covered calls have them)
        for (const o of pp?.options ?? []) {
          if (o.status !== 'log' || !o.open) continue
          const g = o.group
          if (g.side === 'short' && g.type === 'put') {
            await cspOpen({ portfolioId: pid, symbol: g.symbol, strike: g.strike, expiration: g.expiration, contracts: o.open.contracts, premium: o.open.price, on: today })
          } else {
            await optionOpen({ portfolioId: pid, symbol: g.symbol, optionType: g.type, side: g.side, strike: g.strike, expiration: g.expiration, contracts: o.open.contracts, price: o.open.price, isHedge: false, on: today })
          }
          saved++
        }

        // 4. Cash last, straight to the broker's number
        if (p.cash) {
          fresh = await loadData()
          pp = buildPlan(rows, fresh.portfolios, fresh.snaps, closes, today).plans.find((x) => x.portfolio.id === pid)
          if (pp?.cash?.status === 'log') {
            await portfolioSetCash({ portfolioId: pid, balance: pp.cash.broker, countsInReturn: false, on: today })
            saved++
          }
        }
      }
      setSaveResult({ ok: true, text: `Logged ${saved} ${saved === 1 ? 'entry' : 'entries'}. Each one is in its portfolio's Activity and can be undone there.` })
      toast(`Logged ${saved} ${saved === 1 ? 'entry' : 'entries'}`, 'success')
    } catch (e) {
      setSaveResult({
        ok: false,
        text: `Stopped at ${current}: ${e instanceof Error ? e.message : String(e)}. ${saved} ${saved === 1 ? 'entry was' : 'entries were'} saved before that. Fix the problem and upload the same file again; it only logs what is still different.`,
      })
    } finally {
      setAnswers(new Map())
      setSellPrices(new Map())
      setSaving(false)
      const d = await loadData().catch(() => null)
      if (d) setData(d)
    }
  }

  if (loadError) return <PageError what="your portfolios" message={loadError} onRetry={load} />
  if (!data) return <PageLoading label="Loading your portfolios" tiles={0} />

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Match my broker"
        subtitle="Download your positions, change them to what your broker shows, and upload the file. The app logs only the differences."
        back={back ? { to: `/portfolios/${back.id}`, label: back.name } : { to: '/portfolios', label: 'Portfolios' }}
      />

      <Card title="1. Download your positions" subtitle="One spreadsheet for the portfolios you tick, filled in with what the app holds now.">
        {active.length === 0 ? (
          <p className="text-sm text-neutral-400">
            You have no portfolios yet. <Link to="/portfolios" className="text-blue-400 hover:underline">Create one</Link> first.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {active.map((p) => (
                <label key={p.id} className="flex items-center gap-2.5 text-sm text-neutral-200">
                  <input
                    type="checkbox"
                    className="size-4 accent-(--accent)"
                    checked={picked.has(p.id)}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(p.id)
                        else next.delete(p.id)
                        return next
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={<Download size={16} />} onClick={download} disabled={picked.size === 0}>
                Download {picked.size === active.length ? 'all' : picked.size}
              </Button>
              {active.length > 1 && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(active.map((p) => p.id)))}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
                    Select none
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" icon={<FileSpreadsheet size={14} />} onClick={() => downloadSheet([[...SHEET_HEADERS]], 'positions-template.xlsx')}>
                Blank template
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="2. Upload the edited file" subtitle="Open the file in Excel or Google Sheets, change the numbers to what your broker shows, save, and upload it here.">
        <div className="flex flex-col gap-4">
          <div
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-(--border-strong) px-4 py-6 text-center text-sm text-neutral-400"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              onFile(e.dataTransfer.files[0])
            }}
          >
            <Upload size={20} className="text-neutral-500" />
            <span>{fileName ? <span className="text-neutral-200">{fileName}</span> : 'Drop the file here, or'}</span>
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              {fileName ? 'Choose another file' : 'Choose a file'}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <span className="text-xs text-neutral-500">.xlsx, .xls or .csv</span>
          </div>
          {fileError && <Notice tone="red">{fileError}</Notice>}
          <FormatHelp />
        </div>
      </Card>

      {plan && counts && (
        <Card
          title="3. Review and log"
          subtitle="Only portfolios in the file change. Rows marked Check by hand are skipped."
          actions={
            <Button variant="primary" onClick={logAll} disabled={saving || plan.blockedAll || counts.entries === 0 || counts.toAnswer > 0}>
              {saving ? 'Logging…' : counts.entries === 0 ? 'Nothing to log' : `Log all ${counts.entries}`}
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            {saveResult && <Notice tone={saveResult.ok ? 'green' : 'red'}>{saveResult.text}</Notice>}
            <p className="text-sm text-neutral-400">
              {counts.entries} {counts.entries === 1 ? 'entry' : 'entries'} to log
              {counts.toAnswer > 0 && <span className="text-amber-300"> · {counts.toAnswer} {counts.toAnswer === 1 ? 'option needs' : 'options need'} an answer</span>}
              {counts.toCheck > 0 && <span className="text-amber-300"> · {counts.toCheck} to check by hand</span>}
              {plan.problems.length > 0 && <span className="text-red-300"> · {plan.problems.length} {plan.problems.length === 1 ? 'row' : 'rows'} skipped</span>}
              {plan.skippedPortfolios > 0 && <span> · {plan.skippedPortfolios} {plan.skippedPortfolios === 1 ? 'portfolio' : 'portfolios'} not in the file, left as they are</span>}
            </p>

            {plan.problems.length > 0 && (
              <Notice tone="red">
                <ul className="flex flex-col gap-1">
                  {plan.problems.map((p) => (
                    <li key={p.line}>
                      Row {p.line}: {p.message}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}

            {plan.plans.map((p) => (
              <PortfolioReview
                key={p.portfolio.id}
                plan={p}
                answers={effective}
                setAnswer={(key, a) =>
                  setAnswers((prev) => {
                    const next = new Map(prev)
                    if (a) next.set(key, a)
                    else next.delete(key)
                    return next
                  })
                }
                sellPrices={sellPrices}
                setSellPrice={(key, v) => setSellPrices((prev) => new Map(prev).set(key, v))}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function PortfolioReview({
  plan,
  answers,
  setAnswer,
  sellPrices,
  setSellPrice,
}: {
  plan: PortfolioPlan
  answers: Map<string, CloseAnswer>
  setAnswer: (key: string, a: CloseAnswer | null) => void
  sellPrices: Map<string, string>
  setSellPrice: (key: string, v: string) => void
}) {
  const pid = plan.portfolio.id
  const stocks = plan.stocks
  const options = plan.options
  if (plan.blocked) {
    return (
      <section className="overflow-hidden rounded-xl border border-red-500/25">
        <header className="border-b border-(--border) bg-(--card-raised) px-4 py-2.5 text-sm font-semibold text-neutral-100">{plan.portfolio.name}</header>
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-red-200">
          <AlertTriangle size={15} /> {plan.blocked}
        </p>
      </section>
    )
  }
  const changes = stocks.filter((s) => s.status !== 'ok').length + options.filter((o) => o.status !== 'ok').length + (plan.cash?.status === 'log' ? 1 : 0)
  const matching = stocks.filter((s) => s.status === 'ok').length + options.filter((o) => o.status === 'ok').length

  return (
    <section className="overflow-hidden rounded-xl border border-(--border)">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-(--border) bg-(--card-raised) px-4 py-2.5">
        <Link to={`/portfolios/${pid}`} className="text-sm font-semibold text-neutral-100 hover:underline">
          {plan.portfolio.name}
        </Link>
        <span className="text-xs text-neutral-500">
          {changes === 0 ? 'Already matches' : `${changes} to review`}
          {matching > 0 && changes > 0 && ` · ${matching} already ${matching === 1 ? 'matches' : 'match'}`}
        </span>
      </header>
      {changes === 0 ? (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-neutral-400">
          <CheckCircle2 size={15} className="text-(--status-good)" /> Matches your broker.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2 font-medium">Position</th>
                <th className="px-3 py-2 font-medium">In the app</th>
                <th className="px-3 py-2 font-medium">Broker</th>
                <th className="px-4 py-2 font-medium">What gets logged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border)">
              {stocks
                .filter((s) => s.status !== 'ok')
                .map((s) => (
                  <tr key={s.symbol} className="align-top">
                    <td className="px-4 py-3 font-medium text-neutral-100">{s.symbol}</td>
                    <td className="px-3 py-3 text-neutral-300">
                      {s.appQty > 0 ? (
                        <>
                          {qty(s.appQty)} <span className="text-neutral-500">at {price(s.appAvg)}</span>
                        </>
                      ) : (
                        <span className="text-neutral-600">None</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-neutral-300">
                      {s.notInFile ? (
                        <span className="text-neutral-500">Not in file</span>
                      ) : (
                        <>
                          {qty(s.brokerQty)} {s.brokerAvg != null && <span className="text-neutral-500">at {price(s.brokerAvg)}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StockAction s={s} value={sellPrices.get(lineKey(pid, s.symbol))} onPrice={(v) => setSellPrice(lineKey(pid, s.symbol), v)} />
                    </td>
                  </tr>
                ))}
              {options
                .filter((o) => o.status !== 'ok')
                .map((o) => (
                  <tr key={o.key} className="align-top">
                    <td className="px-4 py-3 font-medium text-neutral-100">{optionName(o)}</td>
                    <td className="px-3 py-3 text-neutral-300">{o.appContracts ? `${o.appContracts} contracts` : <span className="text-neutral-600">None</span>}</td>
                    <td className="px-3 py-3 text-neutral-300">{o.brokerContracts ? `${o.brokerContracts} contracts` : <span className="text-neutral-500">None</span>}</td>
                    <td className="px-4 py-3">
                      <OptionAction o={o} answer={answers.get(lineKey(pid, o.key))} onAnswer={(a) => setAnswer(lineKey(pid, o.key), a)} />
                    </td>
                  </tr>
                ))}
              {plan.cash?.status === 'log' && (
                <tr className="align-top">
                  <td className="px-4 py-3 font-medium text-neutral-100">Cash</td>
                  <td className="px-3 py-3 text-neutral-300">{currency(plan.cash.app)}</td>
                  <td className="px-3 py-3 text-neutral-300">{currency(plan.cash.broker)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="self-start">
                        <Pill tone="blue">Set balance to {currency(plan.cash.broker)}</Pill>
                      </span>
                      <span className="text-xs text-neutral-500">Done last, after the entries above, so cash ends at the broker's number.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {!plan.cash && <p className="border-t border-(--border) px-4 py-2 text-xs text-neutral-500">No CASH row for this portfolio, so its cash is left as it is.</p>}
    </section>
  )
}

function StockAction({ s, value, onPrice }: { s: StockLine; value: string | undefined; onPrice: (v: string) => void }) {
  if (s.status === 'check') {
    return (
      <div className="flex flex-col gap-1">
        <span className="self-start">
          <Pill tone="amber">
            <AlertTriangle size={11} /> Check by hand
          </Pill>
        </span>
        <span className="text-xs text-neutral-400">{s.note}</span>
      </div>
    )
  }
  const after = s.side === 'buy' ? `${qty(s.brokerQty)} at ${price(s.brokerAvg ?? s.price!)}` : s.brokerQty > 0 ? `${qty(s.brokerQty)} at ${price(s.appAvg)}` : 'None left'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={s.side === 'buy' ? 'green' : 'red'}>
          {s.side === 'buy' ? 'Buy' : 'Sell'} {qty(s.quantity!)}
          {s.side === 'buy' && ` at ${price(s.price!)}`}
        </Pill>
        {s.side === 'sell' && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            at $
            <input className={`${INPUT_SM} w-24`} inputMode="decimal" value={value ?? (s.price != null ? String(Math.round(s.price * 100) / 100) : '')} onChange={(e) => onPrice(e.target.value)} aria-label={`Sale price for ${s.symbol}`} />
          </label>
        )}
      </div>
      <span className="text-xs text-neutral-400">{s.note}</span>
      <span className="text-xs text-neutral-500">After: {after}</span>
    </div>
  )
}

function OptionAction({ o, answer, onAnswer }: { o: OptionLine; answer: CloseAnswer | undefined; onAnswer: (a: CloseAnswer | null) => void }) {
  if (o.status === 'check' || o.status === 'log') {
    return (
      <div className="flex flex-col gap-1">
        <span className="self-start">
          {o.status === 'check' ? (
            <Pill tone="amber">
              <AlertTriangle size={11} /> Check by hand
            </Pill>
          ) : (
            <Pill tone="green">Open {o.open!.contracts}</Pill>
          )}
        </span>
        <span className="text-xs text-neutral-400">{o.note}</span>
      </div>
    )
  }
  // ask: how did it end?
  const choices = outcomeChoices(o.group)
  const priceText = answer?.price != null ? String(answer.price) : ''
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-400">{o.note} How did it end?</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${INPUT_SM} w-36`}
          value={answer?.outcome ?? ''}
          onChange={(e) => onAnswer(e.target.value ? { outcome: e.target.value as CloseAnswer['outcome'], price: answer?.price ?? null } : null)}
          aria-label={`How ${optionName(o)} ended`}
        >
          <option value="">Choose…</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {answer?.outcome === 'closed' && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            at $
            <input
              className={`${INPUT_SM} w-24`}
              inputMode="decimal"
              placeholder="per share"
              defaultValue={priceText}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[$,]/g, ''))
                onAnswer({ outcome: 'closed', price: e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null })
              }}
              aria-label={`Closing price for ${optionName(o)}`}
            />
          </label>
        )}
      </div>
      {o.close?.partial && <span className="text-xs text-neutral-500">Closes {o.close.contracts} of {o.appContracts} contracts.</span>}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'red' | 'green'; children: ReactNode }) {
  const cls = tone === 'red' ? 'border-red-500/25 bg-red-500/8 text-red-200' : 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200'
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>
}

const EXAMPLE: string[][] = [
  ['Taxable brokerage', 'NVDA', '55', '130.00', '', '', '', '', ''],
  ['Taxable brokerage', 'AAPL', '', '3.10', 'Call', '240', '2026-12-19', 'Short', '2'],
  ['Taxable brokerage', 'CASH', '3450', '', '', '', '', '', ''],
  ['Roth IRA', 'VOO', '40', '455.20', '', '', '', '', ''],
]

function FormatHelp() {
  return (
    <details className="group rounded-xl border border-(--border) px-4 py-3 text-sm text-neutral-400">
      <summary className="cursor-pointer select-none text-neutral-300">What the file looks like</summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs tabular-nums">
            <thead>
              <tr className="text-left text-neutral-500">
                {SHEET_HEADERS.map((h) => (
                  <th key={h} className="border-b border-(--border) px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EXAMPLE.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="border-b border-(--border) px-2 py-1.5 text-neutral-300">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <b className="font-medium text-neutral-300">Stocks and funds:</b> Shares and Avg cost (what you paid per share, as your broker shows it).
          </li>
          <li>
            <b className="font-medium text-neutral-300">Cash:</b> Ticker CASH, with the balance under Shares. Leave the row out to keep the app's cash as it is.
          </li>
          <li>
            <b className="font-medium text-neutral-300">Options:</b> Call/Put, Strike, Expiry, Side (Long if you bought, Short if you sold), Contracts, and the average price per share under Avg cost.
          </li>
          <li>Delete a row for anything you no longer hold. Portfolios not in the file aren't changed.</li>
          <li>Column order doesn't matter, extra columns are ignored, and Symbol, Qty or Average price work as column names too.</li>
        </ul>
      </div>
    </details>
  )
}
