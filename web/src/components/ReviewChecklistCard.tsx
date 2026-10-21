import { useState } from 'react'
import { useReviewChecklist } from '../lib/reviewChecklistContext'
import { allLabels, DEFAULT_CHECKLIST, type ReviewChecklist } from '../lib/reviewChecks'

const MAX_LABEL = 40

const CHIP = {
  good: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300',
  bad: 'border-red-500/40 bg-red-950/40 text-red-300',
} as const

/** One editable list of labels: chips with a remove ×, and a small box to add more. */
function LabelList({
  labels,
  tone,
  lockedLabel,
  onRemove,
  onAdd,
}: {
  labels: string[]
  tone: 'good' | 'bad'
  /** A label that can't be removed (the section's last one), if any. */
  lockedLabel: string | null
  onRemove: (label: string) => void
  onAdd: (label: string) => boolean
}) {
  const [draft, setDraft] = useState('')

  function add() {
    if (onAdd(draft)) setDraft('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`w-3 text-xs ${tone === 'good' ? 'text-emerald-400' : 'text-red-400'}`}>{tone === 'good' ? '✓' : '✗'}</span>
      {labels.map((label) => (
        <span key={label} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${CHIP[tone]}`}>
          {label}
          <button
            onClick={() => onRemove(label)}
            disabled={label === lockedLabel}
            title={label === lockedLabel ? 'Each section needs at least one label' : `Remove ${label}`}
            className="text-neutral-500 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        maxLength={MAX_LABEL}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
        }}
        onBlur={() => draft.trim() && add()}
        placeholder="+ add"
        className="w-24 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-700 focus:bg-neutral-950"
      />
    </div>
  )
}

/** Settings: which done-right (✓) and mistake (✗) labels review offers under Entry /
 * Size / Stop / TP, plus Other mistakes. Saves on every change. Removing a label never
 * changes trades already tagged with it. */
export function ReviewChecklistCard() {
  const { checklist, save } = useReviewChecklist()
  const [error, setError] = useState<string | null>(null)

  function update(next: ReviewChecklist) {
    setError(null)
    save(next).catch((e) => setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`))
  }

  /** Validates and adds; returns false (with a message) if the label is rejected. */
  function tryAdd(raw: string, apply: (label: string) => ReviewChecklist): boolean {
    const label = raw.trim()
    if (!label) return false
    if (allLabels(checklist).some((l) => l.toLowerCase() === label.toLowerCase())) {
      setError(`"${label}" is already in the checklist.`)
      return false
    }
    update(apply(label))
    return true
  }

  const withSection = (i: number, fn: (s: ReviewChecklist['sections'][number]) => ReviewChecklist['sections'][number]) => ({
    ...checklist,
    sections: checklist.sections.map((s, j) => (j === i ? fn(s) : s)),
  })

  return (
    <div className="rounded-2xl border border-(--border) bg-(--card) p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Review checklist</h2>
        <button
          onClick={() => update(DEFAULT_CHECKLIST)}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          Reset to default
        </button>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        What you can pick for each part of a trade review: ✓ done right, ✗ mistake. Removing a label doesn't change
        trades already tagged with it.
      </p>

      <div className="flex flex-col gap-3">
        {checklist.sections.map((s, i) => {
          const only = s.good.length + s.bad.length === 1 ? [...s.good, ...s.bad][0] : null
          return (
            <div key={s.label} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-400">{s.label}</span>
              <LabelList
                labels={s.good}
                tone="good"
                lockedLabel={only}
                onRemove={(l) => update(withSection(i, (x) => ({ ...x, good: x.good.filter((g) => g !== l) })))}
                onAdd={(raw) => tryAdd(raw, (l) => withSection(i, (x) => ({ ...x, good: [...x.good, l] })))}
              />
              <LabelList
                labels={s.bad}
                tone="bad"
                lockedLabel={only}
                onRemove={(l) => update(withSection(i, (x) => ({ ...x, bad: x.bad.filter((b) => b !== l) })))}
                onAdd={(raw) => tryAdd(raw, (l) => withSection(i, (x) => ({ ...x, bad: [...x.bad, l] })))}
              />
            </div>
          )
        })}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">Other mistakes</span>
          <LabelList
            labels={checklist.other}
            tone="bad"
            lockedLabel={null}
            onRemove={(l) => update({ ...checklist, other: checklist.other.filter((o) => o !== l) })}
            onAdd={(raw) => tryAdd(raw, (l) => ({ ...checklist, other: [...checklist.other, l] }))}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-(--status-critical)">{error}</p>}
    </div>
  )
}
