import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccountFilter } from '../accounts/AccountContext'
import { useAuth } from '../auth/AuthContext'
import { createManualTrade, type ManualTradeFields } from '../lib/queries'
import { parseCsvWithHeader } from '../lib/csv'

type TargetField = 'symbol' | 'side' | 'quantity' | 'entry_price' | 'entry_time' | 'exit_price' | 'exit_time' | 'fees' | 'option_type' | 'strike' | 'expiration'

const REQUIRED_FIELDS: { field: TargetField; label: string }[] = [
  { field: 'symbol', label: 'Symbol' },
  { field: 'quantity', label: 'Quantity' },
  { field: 'entry_price', label: 'Entry Price' },
  { field: 'entry_time', label: 'Entry Time' },
]

const OPTIONAL_FIELDS: { field: TargetField; label: string }[] = [
  { field: 'side', label: 'Side (long/short -- defaults to long if unmapped)' },
  { field: 'exit_price', label: 'Exit Price' },
  { field: 'exit_time', label: 'Exit Time' },
  { field: 'fees', label: 'Fees' },
  { field: 'option_type', label: 'Option Type (call/put)' },
  { field: 'strike', label: 'Strike' },
  { field: 'expiration', label: 'Expiration' },
]

const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]

function normalizeSide(raw: string | null): 'long' | 'short' {
  if (!raw) return 'long'
  const v = raw.trim().toLowerCase()
  return v.includes('short') || v.startsWith('s') || v.includes('sell') ? 'short' : 'long'
}

function normalizeDateStr(raw: string): string {
  const d = new Date(raw)
  return isNaN(d.getTime()) ? raw : d.toISOString().slice(0, 10)
}

function rowToFields(
  row: string[],
  headers: string[],
  mapping: Record<TargetField, string | null>,
  accountId: string,
): ManualTradeFields | { error: string } {
  const col = (field: TargetField): string | null => {
    const header = mapping[field]
    if (!header) return null
    const idx = headers.indexOf(header)
    if (idx === -1) return null
    const v = row[idx]
    return v !== undefined && v.trim() !== '' ? v.trim() : null
  }

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
  let exitPrice: number | null = null
  let exitTime: string | null = null
  if (exitPriceRaw && exitTimeRaw) {
    const exitDate = new Date(exitTimeRaw)
    if (isNaN(exitDate.getTime())) return { error: `unparseable exit time "${exitTimeRaw}"` }
    exitPrice = Number(exitPriceRaw)
    exitTime = exitDate.toISOString()
  }

  const optionTypeRaw = col('option_type')
  const strikeRaw = col('strike')
  const expirationRaw = col('expiration')

  return {
    accountId,
    symbol: symbol.toUpperCase(),
    side: normalizeSide(col('side')),
    quantity: Number(quantityRaw),
    entryPrice: Number(entryPriceRaw),
    entryTime: entryDate.toISOString(),
    exitPrice,
    exitTime,
    fees: col('fees') ? Number(col('fees')) : 0,
    optionType: optionTypeRaw ? (optionTypeRaw.toLowerCase().startsWith('p') ? 'put' : 'call') : undefined,
    strike: strikeRaw ? Number(strikeRaw) : undefined,
    expiration: expirationRaw ? normalizeDateStr(expirationRaw) : undefined,
  }
}

export function CsvImportPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { accounts } = useAccountFilter()
  const manualAccounts = accounts.filter((a) => a.sync_mode === 'manual')

  const [accountId, setAccountId] = useState(manualAccounts[0]?.id ?? '')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<TargetField, string | null>>({
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
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<{ success: number; errors: { row: number; message: string }[] } | null>(null)

  function handleFile(file: File) {
    file.text().then((text) => {
      const { headers: h, rows: r } = parseCsvWithHeader(text)
      setHeaders(h)
      setRows(r)
      setResults(null)
      // Best-effort auto-map by exact/loose header name match, so the common case
      // (a header literally named "Entry Price" etc.) needs no manual mapping at all.
      setMapping((prev) => {
        const next = { ...prev }
        for (const { field } of ALL_FIELDS) {
          const guess = h.find((header) => header.trim().toLowerCase().replace(/[\s_-]/g, '') === field.replace(/_/g, ''))
          if (guess) next[field] = guess
        }
        return next
      })
    })
  }

  const requiredMapped = REQUIRED_FIELDS.every(({ field }) => mapping[field])

  const preview = useMemo(() => {
    if (!accountId || rows.length === 0) return []
    return rows.slice(0, 5).map((row) => rowToFields(row, headers, mapping, accountId))
  }, [rows, headers, mapping, accountId])

  async function handleImport() {
    if (!user || !accountId) return
    setImporting(true)
    const errors: { row: number; message: string }[] = []
    let success = 0

    for (let i = 0; i < rows.length; i++) {
      const parsed = rowToFields(rows[i], headers, mapping, accountId)
      if ('error' in parsed) {
        errors.push({ row: i + 2, message: parsed.error }) // +2: 1-indexed, plus the header row
        continue
      }
      try {
        await createManualTrade(user.id, parsed)
        success++
      } catch (err) {
        errors.push({ row: i + 2, message: err instanceof Error ? err.message : String(err) })
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link to="/trades" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Trade Log
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-neutral-100">Import CSV</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Upload any CSV and map its columns below -- no fixed format required. Each row becomes a real trade with
          entry/exit executions, same as manual entry.
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
              {ALL_FIELDS.map(({ field, label }) => (
                <div key={field}>
                  <label className="mb-1 block text-xs text-neutral-500">
                    {label}
                    {REQUIRED_FIELDS.some((f) => f.field === field) && <span className="text-red-400"> *</span>}
                  </label>
                  <select
                    value={mapping[field] ?? ''}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value || null }))}
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
              Preview (first {preview.length} of {rows.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-left uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Entry</th>
                    <th className="px-3 py-2 text-right">Exit</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-b border-neutral-800/60 last:border-0">
                      {'error' in p ? (
                        <td colSpan={6} className="px-3 py-2 text-(--status-critical)">
                          Row {i + 2}: {p.error}
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-neutral-200">{p.symbol}</td>
                          <td className="px-3 py-2 capitalize text-neutral-400">{p.side}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{p.quantity}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{p.entryPrice}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{p.exitPrice ?? '—'}</td>
                          <td className="px-3 py-2 text-neutral-500">{p.exitPrice !== null ? 'Closed' : 'Open'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button
            onClick={handleImport}
            disabled={!requiredMapped || importing}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            {importing ? 'Importing…' : `Import ${rows.length} trade${rows.length === 1 ? '' : 's'}`}
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
                      Row {e.row}: {e.message}
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
