import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccountFilter } from '../accounts/AccountContext'
import { useAuth } from '../auth/AuthContext'
import { parseRobinhoodActivityCsv, type RhSkippedRow } from '../lib/robinhoodCsv'
import { groupRobinhoodExecutions, tradeToFillInputs, tradeImportKey, computeImpliedFee, type RhGroupedTrade } from '../lib/robinhoodTrades'
import { summarizeFills } from '../lib/manualTrade'
import { createImportedTrade } from '../lib/queries'
import { priceFmt, currency, dateTimeFmt } from '../lib/format'

/** Dedicated Robinhood "Activity" CSV importer: parse -> group -> a dry-run preview
 * where individual trades can be excluded -> import only the checked ones as real
 * trades + executions rows (see lib/queries.ts's createImportedTrade). */

type ImportOutcome = 'imported' | 'duplicate' | 'error'

function TradeRow({
  trade,
  selected,
  onToggle,
  outcome,
}: {
  trade: RhGroupedTrade
  selected: boolean
  onToggle: () => void
  outcome?: { status: ImportOutcome; message?: string }
}) {
  const [expanded, setExpanded] = useState(false)
  const fills = useMemo(() => tradeToFillInputs(trade), [trade])
  const summary = useMemo(() => summarizeFills(fills), [fills])
  const fee = useMemo(() => computeImpliedFee(trade), [trade])

  const label =
    trade.assetType === 'option'
      ? `${trade.symbol} ${trade.strike}${trade.optionType?.[0].toUpperCase()} exp ${trade.expiration}`
      : trade.symbol

  return (
    <>
      <tr className="border-b border-(--border) last:border-0 hover:bg-neutral-800/40">
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onToggle} />
        </td>
        <td className="cursor-pointer px-3 py-2 text-neutral-200" onClick={() => setExpanded((v) => !v)}>
          <span className={`mr-1.5 inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
          {label}
        </td>
        <td className="px-3 py-2 text-neutral-400">{trade.assetType === 'option' ? 'Option' : 'Stock'}</td>
        <td className="px-3 py-2 capitalize text-neutral-400">{trade.direction}</td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{trade.executions.length}</td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{trade.orphanEntry ? '—' : priceFmt(summary.avgEntry)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{summary.avgExit !== null ? priceFmt(summary.avgExit) : '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{fee > 0 ? currency(fee) : '—'}</td>
        <td className="px-3 py-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              trade.status === 'OPEN' ? 'bg-blue-950 text-blue-300' : 'bg-neutral-800 text-neutral-300'
            }`}
          >
            {trade.status}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-amber-400/80">
          {trade.orphanEntry && 'entry pre-dates import'}
          {trade.notes.some((n) => n.includes('Assigned')) && 'assigned'}
          {trade.notes.some((n) => n.includes('Expired')) && 'expired worthless'}
        </td>
        <td className="px-3 py-2 text-xs">
          {outcome?.status === 'imported' && <span className="text-(--status-good)">Imported</span>}
          {outcome?.status === 'duplicate' && <span className="text-neutral-500">Already imported</span>}
          {outcome?.status === 'error' && <span className="text-(--status-critical)">{outcome.message ?? 'Failed'}</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-(--border) bg-(--card-raised)/60 last:border-0">
          <td colSpan={10} className="px-3 py-2">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left uppercase tracking-wide text-neutral-600">
                  <th className="px-2 py-1">Time (synthetic ordering, not a real fill time)</th>
                  <th className="px-2 py-1">Tag</th>
                  <th className="px-2 py-1">Side</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-right">Price</th>
                  <th className="px-2 py-1">CSV row(s)</th>
                </tr>
              </thead>
              <tbody>
                {trade.executions.map((e, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 text-neutral-400">{dateTimeFmt(e.filledAt)}</td>
                    <td className="px-2 py-1 capitalize text-neutral-300">{e.tag}</td>
                    <td className="px-2 py-1 capitalize text-neutral-400">{e.side}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-300">{e.quantity}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-300">{priceFmt(e.price)}</td>
                    <td className="px-2 py-1 text-neutral-600">{e.sourceRowIndexes.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trade.notes.length > 0 && (
              <p className="mt-2 text-xs text-amber-400/80">{trade.notes.join(' · ')}</p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export function RobinhoodImportPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { accounts, selectedAccountId } = useAccountFilter()
  const manualAccounts = useMemo(() => accounts.filter((a) => a.sync_mode === 'manual'), [accounts])

  const [accountId, setAccountId] = useState('')
  const defaultedAccountRef = useRef(false)
  useEffect(() => {
    if (defaultedAccountRef.current || manualAccounts.length === 0) return
    defaultedAccountRef.current = true
    // Prefer a Robinhood-labeled account over the switcher's current selection --
    // this importer is Robinhood-specific, so a dedicated Robinhood account (if one
    // exists) is almost always the right default.
    const robinhoodAccount = manualAccounts.find((a) => a.broker === 'robinhood')
    const preferred = manualAccounts.find((a) => a.id === selectedAccountId)
    setAccountId((robinhoodAccount ?? preferred ?? manualAccounts[0]).id)
  }, [manualAccounts, selectedAccountId])

  const [fileName, setFileName] = useState<string | null>(null)
  const [csvText, setCsvText] = useState('')

  function handleFile(file: File) {
    file.text().then((text) => {
      setFileName(file.name)
      setCsvText(text)
    })
  }

  const parsed = useMemo(() => (csvText ? parseRobinhoodActivityCsv(csvText) : null), [csvText])
  const grouped = useMemo(() => (parsed ? groupRobinhoodExecutions(parsed.executions) : null), [parsed])

  const skippedByReason = useMemo(() => {
    if (!parsed) return []
    const map = new Map<string, RhSkippedRow[]>()
    for (const s of parsed.skipped) {
      const list = map.get(s.reason)
      if (list) list.push(s)
      else map.set(s.reason, [s])
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [parsed])

  const [expandedReason, setExpandedReason] = useState<string | null>(null)

  // Selection defaults to "everything" -- the ask is to exclude unwanted trades from
  // an otherwise-import-everything pass, not to opt in one at a time. Resets whenever
  // a new file is parsed.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  useEffect(() => {
    setSelected(grouped ? new Set(grouped.trades.map((_, i) => i)) : new Set())
  }, [grouped])

  const [importing, setImporting] = useState(false)
  const [outcomes, setOutcomes] = useState<Map<number, { status: ImportOutcome; message?: string }>>(new Map())

  function toggleTrade(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function handleImport() {
    if (!user || !grouped) return
    setImporting(true)
    setOutcomes(new Map())

    for (let i = 0; i < grouped.trades.length; i++) {
      if (!selected.has(i)) continue
      const trade = grouped.trades[i]
      let outcome: { status: ImportOutcome; message?: string }
      try {
        await createImportedTrade(user.id, {
          accountId,
          symbol: trade.symbol,
          side: trade.direction,
          assetType: trade.assetType,
          optionType: trade.optionType,
          strike: trade.strike,
          expiration: trade.expiration,
          fills: tradeToFillInputs(trade),
          fee: computeImpliedFee(trade),
          orphanEntry: trade.orphanEntry,
          importKey: tradeImportKey(trade),
        })
        outcome = { status: 'imported' }
      } catch (err) {
        // unique_violation on (user_id, account_id, import_key) -- already imported,
        // not a real failure.
        const code = (err as { code?: string })?.code
        outcome = code === '23505' ? { status: 'duplicate' } : { status: 'error', message: err instanceof Error ? err.message : String(err) }
      }
      // Updated per-row (not batched at the end) so the Result column and running
      // totals reflect progress live -- a multi-hundred-trade import is a real wait,
      // sequential one row at a time (no multi-statement transaction API available;
      // see createManualTrade's doc comment for the same constraint).
      setOutcomes((prev) => new Map(prev).set(i, outcome))
    }

    setImporting(false)
  }

  const importedCount = [...outcomes.values()].filter((o) => o.status === 'imported').length
  const duplicateCount = [...outcomes.values()].filter((o) => o.status === 'duplicate').length
  const errorCount = [...outcomes.values()].filter((o) => o.status === 'error').length

  const flaggedCount = grouped ? grouped.trades.filter((t) => t.orphanEntry).length : 0
  const openCount = grouped ? grouped.trades.filter((t) => t.status === 'OPEN').length : 0

  if (manualAccounts.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Import Robinhood CSV</h1>
        <div className="rounded-2xl border border-(--border) bg-(--card) p-6 text-center text-sm text-neutral-400">
          No manual-entry accounts yet.{' '}
          <Link to="/accounts" className="text-blue-400 hover:underline">
            Create one on the Accounts page
          </Link>{' '}
          first (broker "Robinhood" is recommended, for correct labeling).
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <Link to="/trades" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Trades
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Import Robinhood CSV</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Upload the "Activity" export from Robinhood (Account → Statements &amp; History → Export). Review the
          grouped trades below, uncheck anything you don't want, then import the rest.
        </p>
      </div>

      <div className="rounded-2xl border border-(--border) bg-(--card) p-4">
        <label className="mb-1 block text-xs text-neutral-500">Account</label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="mb-3 w-full rounded-lg border border-(--border-strong) bg-(--card-raised) px-3 py-2 text-sm text-neutral-100 outline-none focus:border-(--accent)"
        >
          {manualAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.broker === 'robinhood' ? ' (Robinhood)' : ''}
            </option>
          ))}
        </select>

        <label className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-300">
          {fileName ? `${fileName} loaded -- choose a different file` : '+ Choose Robinhood CSV file'}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      </div>

      {parsed && grouped && (
        <>
          <div className="rounded-2xl border border-(--border) bg-(--card) p-4 text-sm text-neutral-300">
            Parsed <span className="font-medium text-neutral-100">{parsed.executions.length}</span> fill
            {parsed.executions.length === 1 ? '' : 's'} into{' '}
            <span className="font-medium text-neutral-100">{grouped.trades.length}</span> trade
            {grouped.trades.length === 1 ? '' : 's'}. Skipped{' '}
            <span className="font-medium text-neutral-100">{parsed.skipped.length}</span> row
            {parsed.skipped.length === 1 ? '' : 's'}.
            {flaggedCount > 0 && (
              <>
                {' '}
                <span className="text-amber-400">{flaggedCount} trade{flaggedCount === 1 ? '' : 's'} have an unknown entry</span> (position
                predates this export).
              </>
            )}
            {openCount > 0 && (
              <>
                {' '}
                <span className="text-blue-400">{openCount} still open</span> at the end of the export.
              </>
            )}
          </div>

          {skippedByReason.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-(--border) bg-(--card)">
              <div className="border-b border-(--border) px-4 py-2.5 text-sm font-medium text-neutral-300">Skipped rows, by reason</div>
              <div className="flex flex-col">
                {skippedByReason.map(([reason, rows]) => (
                  <div key={reason} className="border-b border-(--border) last:border-0">
                    <button
                      onClick={() => setExpandedReason(expandedReason === reason ? null : reason)}
                      className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-neutral-400 hover:bg-neutral-800/40"
                    >
                      <span>
                        <span className={`mr-1.5 inline-block transition-transform ${expandedReason === reason ? 'rotate-90' : ''}`}>▸</span>
                        {reason}
                      </span>
                      <span className="tabular-nums text-neutral-500">{rows.length}</span>
                    </button>
                    {expandedReason === reason && (
                      <ul className="flex flex-col gap-0.5 px-4 pb-2 text-[11px] text-neutral-600">
                        {rows.map((r) => (
                          <li key={r.csvRowNumber}>
                            row {r.csvRowNumber}: {r.raw['Instrument'] || '(no instrument)'} — {r.raw['Description']?.split('\n')[0]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-(--border) bg-(--card)">
            <div className="flex items-center justify-between border-b border-(--border) px-4 py-2.5">
              <span className="text-sm font-medium text-neutral-300">Grouped trades (click a row to see its fills)</span>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-neutral-500">{selected.size} of {grouped.trades.length} selected</span>
                <button
                  onClick={() => setSelected(new Set(grouped.trades.map((_, i) => i)))}
                  className="text-blue-400 hover:underline"
                >
                  Select all
                </button>
                <button onClick={() => setSelected(new Set())} className="text-blue-400 hover:underline">
                  Select none
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-(--border) text-left uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2 text-right">Fills</th>
                    <th className="px-3 py-2 text-right">Avg Entry</th>
                    <th className="px-3 py-2 text-right">Avg Exit</th>
                    <th className="px-3 py-2 text-right">Fee</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Flags</th>
                    <th className="px-3 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.trades.map((t, i) => (
                    <TradeRow key={i} trade={t} selected={selected.has(i)} onToggle={() => toggleTrade(i)} outcome={outcomes.get(i)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleImport}
              disabled={importing || selected.size === 0 || !accountId}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {importing ? 'Importing…' : `Import ${selected.size} trade${selected.size === 1 ? '' : 's'}`}
            </button>
            {outcomes.size > 0 && (
              <p className="text-sm text-neutral-400">
                <span className="text-(--status-good)">{importedCount} imported</span>
                {duplicateCount > 0 && <>, <span className="text-neutral-500">{duplicateCount} already imported</span></>}
                {errorCount > 0 && <>, <span className="text-(--status-critical)">{errorCount} failed</span></>}
                .{' '}
                {importedCount > 0 && (
                  <button onClick={() => navigate('/trades')} className="text-blue-400 hover:underline">
                    View in Trades →
                  </button>
                )}
              </p>
            )}
          </div>

          {grouped.warnings.length > 0 && (
            <div className="rounded-2xl border border-(--border) bg-(--card) p-4">
              <h2 className="mb-2 text-sm font-medium text-neutral-300">Grouping warnings</h2>
              <ul className="flex flex-col gap-1 text-xs text-neutral-500">
                {grouped.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
