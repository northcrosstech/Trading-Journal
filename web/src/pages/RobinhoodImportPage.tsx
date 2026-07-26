import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccountFilter } from '../accounts/AccountContext'
import { parseRobinhoodActivityCsv, type RhSkippedRow } from '../lib/robinhoodCsv'
import { groupRobinhoodExecutions, tradeToFillInputs, type RhGroupedTrade } from '../lib/robinhoodTrades'
import { summarizeFills } from '../lib/manualTrade'
import { priceFmt, dateTimeFmt } from '../lib/format'

/** Dedicated Robinhood "Activity" CSV importer -- dry-run preview only. Deliberately
 * stops short of writing anything to the database: parse -> group -> show exactly
 * what would be imported (and what's being skipped/flagged and why) so it can be
 * checked against the source file first. The commit step is a separate, later change. */

function TradeRow({ trade }: { trade: RhGroupedTrade }) {
  const [expanded, setExpanded] = useState(false)
  const fills = useMemo(() => tradeToFillInputs(trade), [trade])
  const summary = useMemo(() => summarizeFills(fills), [fills])

  const label =
    trade.assetType === 'option'
      ? `${trade.symbol} ${trade.strike}${trade.optionType?.[0].toUpperCase()} exp ${trade.expiration}`
      : trade.symbol

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className="cursor-pointer border-b border-neutral-800/60 last:border-0 hover:bg-neutral-800/40"
      >
        <td className="px-3 py-2 text-neutral-200">
          <span className={`mr-1.5 inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
          {label}
        </td>
        <td className="px-3 py-2 text-neutral-400">{trade.assetType === 'option' ? 'Option' : 'Stock'}</td>
        <td className="px-3 py-2 capitalize text-neutral-400">{trade.direction}</td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{trade.executions.length}</td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{trade.orphanEntry ? '—' : priceFmt(summary.avgEntry)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{summary.avgExit !== null ? priceFmt(summary.avgExit) : '—'}</td>
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
      </tr>
      {expanded && (
        <tr className="border-b border-neutral-800/60 bg-neutral-950/60 last:border-0">
          <td colSpan={8} className="px-3 py-2">
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

  const flaggedCount = grouped ? grouped.trades.filter((t) => t.orphanEntry).length : 0
  const openCount = grouped ? grouped.trades.filter((t) => t.status === 'OPEN').length : 0

  if (manualAccounts.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">Import Robinhood CSV</h1>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-400">
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
          ← Trade Log
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-neutral-100">Import Robinhood CSV</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Upload the "Activity" export from Robinhood (Account → Statements &amp; History → Export). This is a
          dry-run preview only -- nothing is written to the database yet.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <label className="mb-1 block text-xs text-neutral-500">Account</label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
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
          <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-300">
            Dry-run only -- reviewing this preview does not write anything to your journal. Nothing is imported until
            a separate commit step (not built yet) runs.
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300">
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
            <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
              <div className="border-b border-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300">Skipped rows, by reason</div>
              <div className="flex flex-col">
                {skippedByReason.map(([reason, rows]) => (
                  <div key={reason} className="border-b border-neutral-800/60 last:border-0">
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

          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            <div className="border-b border-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300">
              Grouped trades (click a row to see its fills)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-left uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2 text-right">Fills</th>
                    <th className="px-3 py-2 text-right">Avg Entry</th>
                    <th className="px-3 py-2 text-right">Avg Exit</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.trades.map((t, i) => (
                    <TradeRow key={i} trade={t} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {grouped.warnings.length > 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
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
