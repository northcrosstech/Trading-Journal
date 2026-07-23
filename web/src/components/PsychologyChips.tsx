import { useState } from 'react'
import type { Emotion } from '../lib/database.types'
import { PHASES } from '../lib/emotions'

type Selected = { emotion_id: string; phase: Emotion['phase'] }

type Props = {
  emotions: Emotion[] // full vocabulary, all phases, non-archived
  selected: Selected[] // this trade's current tags
  thesisNote: string
  reflectionNote: string
  onToggle: (emotion: Emotion, on: boolean) => void
  onThesisNoteChange: (text: string) => void
  onReflectionNoteChange: (text: string) => void
  onAddEmotion: (phase: Emotion['phase'], name: string) => void
}

function AddChipButton({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="rounded-full border border-dashed border-neutral-700 px-3 py-1 text-xs text-neutral-500 hover:border-neutral-500 hover:text-neutral-300"
      >
        + Add
      </button>
    )
  }

  return (
    <input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => {
        if (name.trim()) onAdd(name.trim())
        setAdding(false)
        setName('')
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (name.trim()) onAdd(name.trim())
          setAdding(false)
          setName('')
        }
        if (e.key === 'Escape') {
          setAdding(false)
          setName('')
        }
      }}
      placeholder="New tag…"
      className="w-24 rounded-full border border-blue-500 bg-neutral-950 px-3 py-1 text-xs text-neutral-100 outline-none"
    />
  )
}

/** Tap-to-toggle emotion chips grouped by phase, plus the two phase-adjacent notes
 * (thesis near Before, reflection near After -- During has chips only, no note).
 * Deliberately controlled/stateless about persistence: the caller decides whether a
 * toggle is applied immediately (trade detail page, trade already exists) or held in
 * local form state until submit (manual entry, trade doesn't exist yet). Designed to
 * be fast -- a few taps, no required fields, nothing blocks leaving the page. */
export function PsychologyChips({
  emotions,
  selected,
  thesisNote,
  reflectionNote,
  onToggle,
  onThesisNoteChange,
  onReflectionNoteChange,
  onAddEmotion,
}: Props) {
  const isSelected = (emotionId: string) => selected.some((s) => s.emotion_id === emotionId)

  return (
    <div className="flex flex-col gap-4">
      {PHASES.map(({ phase, label }) => {
        const phaseEmotions = emotions.filter((e) => e.phase === phase && !e.archived)
        return (
          <div key={phase}>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {phaseEmotions.map((emotion) => {
                const active = isSelected(emotion.id)
                return (
                  <button
                    key={emotion.id}
                    type="button"
                    onClick={() => onToggle(emotion, !active)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      active
                        ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                        : 'border-neutral-700 bg-neutral-950 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    {emotion.name}
                  </button>
                )
              })}
              <AddChipButton onAdd={(name) => onAddEmotion(phase, name)} />
            </div>
            {phase === 'before' && (
              <textarea
                value={thesisNote}
                onChange={(e) => onThesisNoteChange(e.target.value)}
                placeholder="Why'd you take it? (optional)"
                rows={2}
                className="mt-2 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            )}
            {phase === 'after' && (
              <textarea
                value={reflectionNote}
                onChange={(e) => onReflectionNoteChange(e.target.value)}
                placeholder="How'd it feel after? (optional)"
                rows={2}
                className="mt-2 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
