import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccountFilter } from '../accounts/AccountContext'
import { useAuth } from '../auth/AuthContext'
import { createManualTrade, type ManualTradeFields } from '../lib/queries'
import { summarizeFills, type FillAction, type FillInput } from '../lib/manualTrade'
import { parseCsvWithHeader } from '../lib/csv'
import { priceFmt } from '../lib/format'

// ---------------------------------------------------------------------------
// Simple mode: one CSV row = one trade (single entry fill, optional single exit
// fill) -- the original, still-default behavior for a file with one row per trade.
// ---------------------------------------------------------------------------

type SimpleField = 'symbol' | 'side' | 'quantity' | 'entry_price' | 'entry_time' | 'exit_price' | 'exit_time' | 'fees' | 'option_type' | 'strike' | 'expiration'

const SIMPLE_REQUIRED: { field: SimpleField; label: string }[] = [
  { field: 'symbol', label: 'Symbol' },
  { field: 'quantity', label: 'Quantity' },
  { field: 'entry_price', label: 'Entry Price' },
  { field: 'entry_time', label: 'Entry Time' },
]

const SIMPLE_OPTIONAL: { field: SimpleField; label: string }[] = [
  { field: 'side', label: 'Side (long/short -- defaults to long if unmapped)' },
  { field: 'exit_price', label: 'Exit Price' },
  { field: 'exit_time', label: 'Exit Time' },
  { field: 'fees', label: 'Fees' },
  { field: 'option_type', label: 'Option Type (call/put)' },
  { field: 'strike', label: 'Strike' },
  { field: 'expiration', label: 'Expiration' },
]

const SIMPLE_ALL = [...SIMPLE_REQUIRED, ...SIMPLE_OPTIONAL]

// ---------------------------------------------------------------------------
// Fill mode: one CSV row = one FILL. Rows sharing the same "Trade Group" value
// become one trade with N fills -- this is what lets a trimmed/scaled-in trade
// round-trip through a spreadsheet at all.
// ---------------------------------------------------------------------------

type FillField = 'symbol' | 'trade_group' | 'action' | 'side' | 'fill_time' | 'fill_price' | 'fill_quantity' | 'fees' | 'option_type' | 'strike' | 'expiration'

const FILL_REQUIRED: { field: FillField; label: string }[] = [
  { field: 'symbol', label: 'Symbol' },
  { field: 'trade_group', label: 'Trade Group (same value = same trade)' },
  { field: 'action', label: 'Action (open/add/trim/close)' },
  { field: 'fill_time', label: 'Fill Time' },
  { field: 'fill_price', label: 'Fill Price' },
  { field: 'fill_quantity', label: 'Fill Quantity' },
]

const FILL_OPTIONAL: { field: FillField; label: string }[] = [
  { field: 'side', label: 'Side (long/short -- defaults to long if unmapped)' },
  { field: 'fees', label: 'Fees (summed across the group\'s rows)' },
  { field: 'option_type', label: 'Option Type (call/put)' },
  { field: 'strike', label: 'Strike' },
  { field: 'expiration', label: 'Expiration' },
]

const FILL_ALL = [...FILL_REQUIRED, ...FILL_OPTIONAL]

function normalizeSide(raw: string | null): 'long' | 'short' {
  if (!raw) return 'long'
  const v = raw.trim().toLowerCase()
  return v.includes('short') || v.startsWith('s') || v.includes('sell') ? 'short' : 'long'
}

function normalizeAction(raw: string | null): FillAction {
  if (!raw) return 'open'
  const v = raw.trim().toLowerCase()
  if (v.startsWith('add')) return 'add'
  if (v.startsWith('trim')) return 'trim'
  if (v.startsWith('close') || v.startsWith('exit')) return 'close'
  return 'open'
}

function normalizeDateStr(raw: string): string {
  const d = new Date(raw)
  return isNaN(d.getTime()) ? raw : d.toISOString().slice(0, 10)
}

function makeColReader(row: string[], headers: string[], mapping: Record<string, string | null>) {
  return (field: string): string | null => {
    const header = mapping[field]
    if (!header) return null
    const idx = headers.indexOf(header)
    if (idx === -1) return null
    const v = row[idx]
    return v !== undefined && v.trim() !== '' ? v.trim() : null
  }
}

type ImportError = { error: string; rowIndex?: number }

function rowToSimpleTrade(
  row: string[],
  headers: string[],
  mapping: Record<SimpleField, string | null>,
  accountId: string,
): ManualTradeFields | ImportError {
  const col = makeColReader(row, headers, mapping)

  const symbol = col('symbol')
  if (!symbol) return { error: 'missing symbol' }

  const quantityRaw = col('quantity')
  if (!quantityRaw || isNaN(Number(quantityRaw))) return { error: 'missing/invalid quantity' }

  const entryPriceRaw = col('entry_price')
  if (!entryPriceRaw || isNaN(Number(entryPriceRaw))) return { error: 'missing/invalid entry price' }

  const entryTimeRaw = col('entry_time')
  if (!entryTimeRaw) return { error: 'missing entry time' }
  const entryDate = new Date(entryTimeRaw)
  if (isNaN(entryDate.getTime())) return { error: `unparseable entry time "${entryTimeRaw}"` }

  const exitPriceRaw = col('exit_price')
  const exitTimeRaw = col('exit_time')
  const fills: FillInput[] = [{ action: 'open', time: entryDate.toISOString(), price: Number(entryPriceRaw), quantity: Number(quantityRaw) }]
  if (exitPriceRaw && exitTimeRaw) {
    const exitDate = new Date(exitTimeRaw)
    if (isNaN(exitDate.getTime())) return { error: `unparseable exit time "${exitTimeRaw}"` }
    fills.push({ action: 'close', time: exitDate.toISOString(), price: Number(exitPriceRaw), quantity: Number(quantityRaw) })
  }

  const optionTypeRaw = col('option_type')
  const strikeRaw = col('strike')
  const expirationRaw = col('expiration')

  return {
    accountId,
    symbol: symbol.toUpperCase(),
    side: normalizeSide(col('side')),
    fills,
    fees: col('fees') ? Number(col('fees')) : 0,
    optionType: optionTypeRaw ? (optionTypeRaw.toLowerCase().startsWith('p') ? 'put' : 'call') : undefined,
    strike: strikeRaw ? Number(strikeRaw) : undefined,
    expiration: expirationRaw ? normalizeDateStr(expirationRaw) : undefined,
  }
}

type FillModeRow = {
  groupId: string
  symbol: string
  side: string | null
  action: FillAction
  time: string
  price: number
  quantity: number
  fees: number
  optionType: string | null
  strike: string | null
  expiration: string | null
}

function rowToFillModeRow(row: string[], headers: string[], mapping: Record<FillField, string | null>): FillModeRow | ImportError {
  const col = makeColReader(row, headers, mapping)

  const symbol = col('symbol')
  if (!symbol) return { error: 'missing symbol' }

  const groupId = col('trade_group')
  if (!groupId) return { error: 'missing trade group' }

  const priceRaw = col('fill_price')
  if (!priceRaw || isNaN(Number(priceRaw))) return { error: 'missing/invalid fill price' }

  const quantityRaw = col('fill_quantity')
  if (!quantityRaw || isNaN(Number(quantityRaw))) return { error: 'missing/invalid fill quantity' }

  const timeRaw = col('fill_time')
  if (!timeRaw) return { error: 'missing fill time' }
  const date = new Date(timeRaw)
  if (isNaN(date.getTime())) return { error: `unparseable fill time "${timeRaw}"` }

  return {
    groupId,
    symbol: symbol.toUpperCase(),
    side: col('side'),
    action: normalizeAction(col('action')),
    time: date.toISOString(),
    price: Number(priceRaw),
    quantity: Number(quantityRaw),
    fees: col('fees') ? Number(col('fees')) : 0,
    optionType: col('option_type'),
    strike: col('strike'),
    expiration: col('expiration'),
  }
}

/** Groups fill-mode rows by trade_group, sorts each group's fills by time, and
 * builds one ManualTradeFields per group -- this is what makes a trimmed/scaled-in
 * trade importable at all: several CSV rows (fills) collapse into one trade. */
function groupFillRows(fillRows: (FillModeRow | ImportError)[], accountId: string): (ManualTradeFields | ImportError)[] {
  const groups = new Map<string, { row: FillModeRow; rowIndex: number }[]>()
  const errors: ImportError[] = []

  fillRows.forEach((r, i) => {
    if ('error' in r) {
      errors.push({ ...r, rowIndex: r.rowIndex ?? i })
      return
    }
    const list = groups.get(r.groupId)
    if (list) list.push({ row: r, rowIndex: i })
    else groups.set(r.groupId, [{ row: r, rowIndex: i }])
  })

  const trades: (ManualTradeFields | ImportError)[] = [...errors]
  for (const [, entries] of groups) {
    const sorted = [...entries].sort((a, b) => new Date(a.row.time).getTime() - new Date(b.row.time).getTime())
    const first = sorted[0].row
    const side = sorted.map((e) => e.row.side).find((s) => s) ?? null
    const optionType = sorted.map((e) => e.row.optionType).find((s) => s) ?? null
    const strike = sorted.map((e) => e.row.strike).find((s) => s) ?? null
    const expiration = sorted.map((e) => e.row.expiration).find((s) => s) ?? null
    const totalFees = sorted.reduce((sum, e) => sum + e.row.fees, 0)

    trades.push({
      accountId,
      symbol: first.symbol,
      side: normalizeSide(side),
      fills: sorted.map((e) => ({ action: e.row.action, time: e.row.time, price: e.row.price, quantity: e.row.quantity })),
      fees: totalFees,
      optionType: optionType ? (optionType.toLowerCase().startsWith('p') ? 'put' : 'call') : undefined,
      strike: strike ? Number(strike) : undefined,
      expiration: expiration ? normalizeDateStr(expiration) : undefined,
    })
  }

  return trades
}

export function CsvImportPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { accounts, selectedAccountId } = useAccountFilter()
  // Memoized so it's referentially stable across renders (only changes when
  // `accounts` itself does).
  const manualAccounts = useMemo(() => accounts.filter((a) => a.sync_mode === 'manual'), [accounts])

  const [accountId, setAccountId] = useState('')
  // manualAccounts loads asynchronously (from context), so a synchronous useState
  // initializer would default to '' and never update -- this runs once, the first
  // time there's something to choose from, preferring the switcher's current
  // selection if it accepts manual entry.
  const defaultedAccountRef = useRef(false)
  useEffect(() => {
    if (defaultedAccountRef.current || manualAccounts.length === 0) return
    defaultedAccountRef.current = true
    const preferred = manualAccounts.find((a) => a.id === selectedAccountId)
    setAccountId((preferred ?? manualAccounts[0]).id)
  }, [manualAccounts, selectedAccountId])
  const [multiFillMode, setMultiFillMode] = useState(false)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [simpleMapping, setSimpleMapping] = useState<Record<SimpleField, string | null>>({
    symbol: null,
    side: null,
    quantity: null,
    entry_price: null,
    entry_time: null,
    exit_price: null,
    exit_time: null,
    fees: null,
    option_type: null,
    strike: null,
    expiration: null,
  })
  const [fillMapping, setFillMapping] = useState<Record<FillField, string | null>>({
    symbol: null,
    trade_group: null,
    action: null,
    side: null,
    fill_time: null,
    fill_price: null,
    fill_quantity: null,
    fees: null,
    option_type: null,
    strike: null,
    expiration: null,
  })
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<{ success: number; errors: { row: string; message: string }[] } | null>(null)

  function handleFile(file: File) {
    file.text().then((text) => {
      const { headers: h, rows: r } = parseCsvWithHeader(text)
      setHeaders(h)
      setRows(r)
      setResults(null)
      // Best-effort auto-map by exact/loose header name match, so the common case
      // (a header literally named "Entry Price" etc.) needs no manual mapping at all.
      const guess = (field: string) => h.find((header) => header.trim().toLowerCase().replace(/[\s_-]/g, '') === field.replace(/_/g, ''))
      setSimpleMapping((prev) => {
        const next = { ...prev }
        for (const { field } of SIMPLE_ALL) {
          const g = guess(field)
          if (g) next[field] = g
        }
        return next
      })
      setFillMapping((prev) => {
        const next = { ...prev }
        for (const { field } of FILL_ALL) {
          const g = guess(field)
          if (g) next[field] = g
        }
        return next
      })
    })
  }

  const requiredMapped = multiFillMode
    ? FILL_REQUIRED.every(({ field }) => fillMapping[field])
    : SIMPLE_REQUIRED.every(({ field }) => simpleMapping[field])

  const allParsed = useMemo(() => {
    if (!accountId || rows.length === 0) return []
    if (!multiFillMode) {
      return rows.map((row) => rowToSimpleTrade(row, headers, simpleMapping, accountId))
    }
    const fillRows = rows.map((row, i) => {
      const parsed = rowToFillModeRow(row, headers, fillMapping)
      return 'error' in parsed ? { ...parsed, rowIndex: i } : parsed
    })
    return groupFillRows(fillRows, accountId)
  }, [rows, headers, simpleMapping, fillMapping, accountId, multiFillMode])

  const preview = allParsed.slice(0, 5)

  async function handleImport() {
    if (!user || !accountId) return
    setImporting(true)
    const errors: { row: string; message: string }[] = []
    let success = 0

    for (let i = 0; i < allParsed.length; i++) {
      const parsed = allParsed[i]
      if ('error' in parsed) {
        const rowLabel = parsed.rowIndex !== undefined ? `CSV row ${parsed.rowIndex + 2}` : `#${i + 2}`
        errors.push({ row: rowLabel, message: parsed.error })
        continue
      }
      const rowLabel = multiFillMode ? parsed.symbol : `#${i + 2}`
      try {
        await createManualTrade(user.id, parsed)
        success++
      } catch (err) {
        errors.push({ row: rowLabel, message: err instanceof Error ? err.message : String(err) })
      }
    }

    setResults({ success, errors })
    setImporting(false)
  }

  if (manualAccounts.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">Import CSV</h1>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-400">
          No manual-entry accounts yet.{' '}
          <Link to="/accounts" className="text-blue-400 hover:underline">
            Create one on the Accounts page
          </Link>{' '}
          first.
        </div>
      </div>
    )
  }

  const activeFields = multiFillMode ? FILL_ALL : SIMPLE_ALL
  const activeRequired = multiFillMode ? FILL_REQUIRED : SIMPLE_REQUIRED
  const mapping = multiFillMode ? fillMapping : simpleMapping
  const setMapping = multiFillMode
    ? (field: string, value: string | null) => setFillMapping((prev) => ({ ...prev, [field]: value }))
    : (field: string, value: string | null) => setSimpleMapping((prev) => ({ ...prev, [field]: value }))

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link to="/trades" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Trade Log
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-neutral-100">Import CSV</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Upload any CSV and map its columns below -- no fixed format required. Each trade becomes real executions
          rows, same as manual entry.
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
            </option>
          ))}
        </select>

        <label className="mb-3 flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={multiFillMode} onChange={(e) => setMultiFillMode(e.target.checked)} />
          This file has multiple fills per trade (trims / scaled-in entries)
        </label>

        <label className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-300">
          {headers.length > 0 ? `${rows.length} row${rows.length === 1 ? '' : 's'} loaded -- choose a different file` : '+ Choose CSV file'}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      </div>

      {headers.length > 0 && (
        <>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-3 text-sm font-medium text-neutral-300">Map Columns</h2>
            <div className="grid grid-cols-2 gap-3">
              {activeFields.map(({ field, label }) => (
                <div key={field}>
                  <label className="mb-1 block text-xs text-neutral-500">
                    {label}
                    {activeRequired.some((f) => f.field === field) && <span className="text-red-400"> *</span>}
                  </label>
                  <select
                    value={mapping[field as keyof typeof mapping] ?? ''}
                    onChange={(e) => setMapping(field, e.target.value || null)}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
                  >
                    <option value="">— none —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            <div className="border-b border-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300">
              Preview (first {preview.length} of {allParsed.length} trade{allParsed.length === 1 ? '' : 's'})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-left uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2 text-right">Fills</th>
                    <th className="px-3 py-2 text-right">Avg Entry</th>
                    <th className="px-3 py-2 text-right">Avg Exit</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => {
                    if ('error' in p) {
                      return (
                        <tr key={i} className="border-b border-neutral-800/60 last:border-0">
                          <td colSpan={6} className="px-3 py-2 text-(--status-critical)">
                            {p.rowIndex !== undefined ? `CSV row ${p.rowIndex + 2}` : `Row ${i + 2}`}: {p.error}
                          </td>
                        </tr>
                      )
                    }
                    const summary = summarizeFills(p.fills)
                    return (
                      <tr key={i} className="border-b border-neutral-800/60 last:border-0">
                        <td className="px-3 py-2 text-neutral-200">{p.symbol}</td>
                        <td className="px-3 py-2 capitalize text-neutral-400">{p.side}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{p.fills.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{priceFmt(summary.avgEntry)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{summary.avgExit !== null ? priceFmt(summary.avgExit) : '—'}</td>
                        <td className="px-3 py-2 text-neutral-500">{summary.closed ? 'Closed' : 'Open'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <button
            onClick={handleImport}
            disabled={!requiredMapped || importing}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            {importing ? 'Importing…' : `Import ${allParsed.length} trade${allParsed.length === 1 ? '' : 's'}`}
          </button>
          {!requiredMapped && <p className="text-xs text-amber-400/80">Map all required (*) columns before importing.</p>}

          {results && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <p className="text-sm text-neutral-200">
                Imported <span className="text-(--status-good)">{results.success}</span> trade{results.success === 1 ? '' : 's'}
                {results.errors.length > 0 && (
                  <>
                    , <span className="text-(--status-critical)">{results.errors.length}</span> failed
                  </>
                )}
                .
              </p>
              {results.errors.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-neutral-500">
                  {results.errors.map((e, i) => (
                    <li key={i}>
                      {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {results.success > 0 && (
                <button onClick={() => navigate('/trades')} className="mt-3 text-xs text-blue-400 hover:underline">
                  View in Trade Log →
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
