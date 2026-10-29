import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchTheses, saveThesis } from '../lib/wealthQueries'
import { centralDateStr, dateFmt } from '../lib/format'
import { INPUT, INPUT_SM } from '../lib/ui'
import { useToast } from '../lib/toastContext'
import { Button } from './ui/Button'
import { Pill } from './ui/Pill'

/** A date `months` from today (Central time), as YYYY-MM-DD. */
function monthsFromToday(months: number): string {
  const d = new Date(`${centralDateStr(new Date())}T12:00:00`)
  d.setMonth(d.getMonth() + months)
  return centralDateStr(d)
}

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return centralDateStr(d)
}

/** Your thesis for a ticker -- why you own it and what would make you sell -- with a date to
 * look at it again. One per ticker, shared by every portfolio and the watchlist. */
export function ThesisBox({ symbol, earningsDate, onSaved }: { symbol: string; earningsDate: string | null; onSaved?: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [loaded, setLoaded] = useState<{ thesis: string; review: string } | null>(null)
  const [thesis, setThesis] = useState('')
  const [review, setReview] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    setLoaded(null)
    fetchTheses([symbol])
      .then((m) => {
        if (!live) return
        const t = m.get(symbol)
        const v = { thesis: t?.thesis ?? '', review: t?.review_on ?? '' }
        setLoaded(v)
        setThesis(v.thesis)
        setReview(v.review)
      })
      .catch(() => live && setLoaded({ thesis: '', review: '' }))
    return () => {
      live = false
    }
  }, [symbol])

  const changed = loaded !== null && (thesis !== loaded.thesis || review !== loaded.review)
  const due = !!loaded?.review && loaded.review <= centralDateStr(new Date())

  async function save() {
    if (!user) return
    setSaving(true)
    try {
      await saveThesis(user.id, symbol, thesis, review || null)
      setLoaded({ thesis: thesis.trim(), review })
      setThesis(thesis.trim())
      toast(`${symbol}: thesis saved`)
      onSaved?.()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const preset = (label: string, date: string) => (
    <button key={label} type="button" onClick={() => setReview(date)} className="rounded-md px-1.5 py-0.5 text-xs text-(--accent-text) hover:bg-(--card-raised)">
      {label}
    </button>
  )

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Your thesis</h3>
        {due && <Pill tone="amber">review due {dateFmt(loaded?.review)}</Pill>}
      </div>
      <textarea
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        disabled={loaded === null}
        rows={4}
        placeholder={'Why you own it, and what would make you sell.\ne.g. AI data-center leader; sell if data-center revenue growth falls under 20% for two quarters.'}
        className={INPUT}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400">
          Review on
          <input type="date" value={review} onChange={(e) => setReview(e.target.value)} className={`${INPUT_SM.replace('w-full ', '')} w-auto`} />
          {preset('3 mo', monthsFromToday(3))}
          {preset('6 mo', monthsFromToday(6))}
          {preset('1 yr', monthsFromToday(12))}
          {earningsDate && preset('after earnings', dayAfter(earningsDate))}
          {review && (
            <button type="button" onClick={() => setReview('')} className="rounded-md px-1.5 py-0.5 text-xs text-neutral-500 hover:text-white">
              no date
            </button>
          )}
        </label>
        <Button size="sm" variant="primary" onClick={save} disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Save thesis'}
        </Button>
      </div>
    </section>
  )
}
