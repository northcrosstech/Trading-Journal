import { useEffect, useState } from 'react'
import type { Playbook, TradeWithDetails } from '../lib/database.types'
import type { TradeJournal } from '../lib/useTradeJournal'
import { strengthsOf } from '../lib/strengths'
import { allLabels, reviewMissing, shortcutTags } from '../lib/reviewChecks'
import { useReviewChecklist } from '../lib/reviewChecklistContext'
import { tradeOutcome, OUTCOME_LABEL, rFmt, type OutcomeKind } from '../lib/whatIf'
import { currency } from '../lib/format'
import { ORIGINS } from '../lib/origin'
import { tagChipStyle } from '../lib/tagColors'

function Kbd({ children }: { children: string }) {
  return <kbd className="ml-1.5 rounded border border-neutral-700 px-1 text-[10px] text-neutral-500">{children}</kbd>
}

type PriceField = 'stop_price' | 'target_price' | 'alt_exit_price'

/** Option-premium price box that saves on blur / Enter; blank clears it. */
function PriceInput({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number | null
  onCommit: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])

  function commit() {
    const trimmed = draft.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setDraft(value === null ? '' : String(value))
      return
    }
    if (next !== value) onCommit(next)
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="w-full rounded-lg border border-(--border-strong) bg-(--card-raised) px-2 py-1.5 text-sm tabular-nums text-neutral-100 outline-none focus:border-(--accent)"
      />
    </label>
  )
}

const ORIGIN_ACTIVE = {
  planned: 'border-emerald-600 bg-emerald-950/60 text-emerald-300',
  unplanned: 'border-amber-600 bg-amber-950/50 text-amber-300',
  followed: 'border-sky-600 bg-sky-950/50 text-sky-300',
} as const

const OUTCOME_TONE: Record<OutcomeKind, string> = {
  left_on_table: 'text-red-400',
  cost_of_ignoring_stop: 'text-red-400',
  cost_of_discipline: 'text-neutral-400',
  saved_by_discipline: 'text-emerald-400',
  beat_alternative: 'text-emerald-400',
}

/** Stop / target / alternative exit, all in option premium, and what they imply: 1R,
 * planned vs realized R, and the dollar difference to the alternative exit. Keyed by
 * trade id so inputs and open state reset when the review moves to the next trade. */
function WhatIf({ trade, journal }: { trade: TradeWithDetails; journal: TradeJournal }) {
  const hasAny = trade.stop_price != null || trade.target_price != null || trade.alt_exit_price != null
  const [open, setOpen] = useState(hasAny)

  const o = tradeOutcome(trade)
  const set = (field: PriceField) => (v: number | null) => journal.setPrice(field, v)

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1.5 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
      >
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        What if
        {!open && o.kind && <span className={`ml-1 normal-case ${OUTCOME_TONE[o.kind]}`}>· {OUTCOME_LABEL[o.kind]}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <PriceInput label="Stop" value={trade.stop_price ?? null} onCommit={set('stop_price')} />
            <PriceInput label="Target" value={trade.target_price ?? null} onCommit={set('target_price')} />
            <PriceInput label="Alt exit" value={trade.alt_exit_price ?? null} onCommit={set('alt_exit_price')} />
          </div>
          <p className="text-[11px] text-neutral-600">
            Option premium. Alt exit = where the whole position could have closed instead (held to target, honored the stop…).
          </p>
          {(o.risk !== null || o.kind) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-(--card-raised) px-3 py-2 text-xs text-neutral-400">
              {o.risk !== null && (
                <>
                  <span>
                    1R <span className="text-neutral-200">{currency(o.risk)}</span>
                  </span>
                  <span>
                    planned <span className="text-neutral-200">{rFmt(o.plannedR)}</span>
                  </span>
                  <span>
                    realized <span className="text-neutral-200">{rFmt(o.realizedR)}</span>
                  </span>
                </>
              )}
              {o.kind && o.delta !== null && (
                <span className={OUTCOME_TONE[o.kind]}>
                  {OUTCOME_LABEL[o.kind]}: {currency(Math.abs(o.delta))}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Section heading; required sections get a dot, and turn amber when `missing` is set
 * (the review queue sets it after a Next with unanswered sections). */
function SectionTitle({ children, required = false, missing = false }: { children: string; required?: boolean; missing?: boolean }) {
  return (
    <h3 className={`mb-1.5 text-xs font-medium uppercase tracking-wide ${missing ? 'text-amber-400' : 'text-neutral-500'}`}>
      {children}
      {required && <span className={missing ? 'text-amber-400' : 'text-neutral-600'}> •</span>}
    </h3>
  )
}

function TagChip({
  tag,
  active,
  tone,
  kbd,
  onClick,
}: {
  tag: string
  active: boolean
  tone: 'good' | 'bad'
  kbd: string | null
  onClick: () => void
}) {
  const activeClass = tone === 'good' ? 'border-emerald-500/60 bg-emerald-950/60 text-emerald-300' : 'border-red-500/60 bg-red-950/60 text-red-300'
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        active ? activeClass : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
      }`}
    >
      {tone === 'good' ? '✓ ' : '✗ '}
      {tag}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  )
}

/** The whole per-trade journal: whose idea (planned / unplanned / followed), the
 * Entry / Size / Stop / TP checklist, setup, what if, one note, screenshot. Whose idea,
 * the four checks and setup are required -- `highlightMissing` marks the unanswered
 * ones. `shortcuts` shows the review queue's key hints next to each control. */
export function TradeJournalPanel({
  trade,
  journal,
  setups,
  shortcuts = false,
  highlightMissing = false,
}: {
  trade: TradeWithDetails
  journal: TradeJournal
  setups: Playbook[]
  shortcuts?: boolean
  highlightMissing?: boolean
}) {
  const currentSetupId = trade.trade_playbooks?.playbook_id ?? null
  const visibleSetups = setups.filter((s) => !s.archived || s.id === currentSetupId)
  const { checklist } = useReviewChecklist()
  const missing = new Set(highlightMissing ? reviewMissing(trade, setups, checklist) : [])
  const strengths = strengthsOf(trade)
  // Other = the checklist's Other mistakes, plus any tag on this trade whose label has
  // since been removed from the checklist (kept visible so it can still be untagged).
  const known = new Set(allLabels(checklist))
  const otherMistakes = [...checklist.other, ...trade.mistakes.filter((m) => !known.has(m))]
  const otherStrengths = strengths.filter((s) => !known.has(s))
  const keys = shortcutTags(checklist)
  const keyOf = (list: string[], tag: string, prefix: string) => {
    const i = list.indexOf(tag)
    return shortcuts && i >= 0 && i < 9 ? `${prefix}${i + 1}` : null
  }
  const strengthKey = (tag: string) => keyOf(keys.good, tag, '⇧')
  const mistakeKey = (tag: string) => keyOf(keys.bad, tag, '')

  return (
    <div className="flex flex-col gap-4">
      <section>
        <SectionTitle required missing={missing.has('Whose idea')}>Whose idea was it?</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {ORIGINS.map(({ value, label, key }) => {
            const active = trade.trade_origin === value
            return (
              <button
                key={value}
                onClick={() => journal.setOrigin(active ? null : value)}
                title={value === 'followed' ? 'Someone else\u2019s call: alert, Discord, mentor, signal' : undefined}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  active ? ORIGIN_ACTIVE[value] : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                }`}
              >
                {label}
                {shortcuts && <Kbd>{key}</Kbd>}
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <SectionTitle required missing={checklist.sections.some((c) => missing.has(c.label))}>Checklist</SectionTitle>
        <div className="flex flex-col gap-2">
          {checklist.sections.map((c) => (
            <div key={c.label} className="flex items-start gap-2">
              <span className={`w-11 shrink-0 pt-1 text-xs font-medium ${missing.has(c.label) ? 'text-amber-400' : 'text-neutral-400'}`}>{c.label}</span>
              <div className="flex flex-wrap gap-1.5">
                {c.good.map((tag) => (
                  <TagChip key={tag} tag={tag} tone="good" active={strengths.includes(tag)} kbd={strengthKey(tag)} onClick={() => journal.toggleStrength(tag)} />
                ))}
                {c.bad.map((tag) => (
                  <TagChip key={tag} tag={tag} tone="bad" active={trade.mistakes.includes(tag)} kbd={mistakeKey(tag)} onClick={() => journal.toggleMistake(tag)} />
                ))}
              </div>
            </div>
          ))}
          {(otherMistakes.length > 0 || otherStrengths.length > 0) && (
            <div className="flex items-start gap-2">
              <span className="w-11 shrink-0 pt-1 text-xs font-medium text-neutral-500">Other</span>
              <div className="flex flex-wrap gap-1.5">
                {otherStrengths.map((tag) => (
                  <TagChip key={tag} tag={tag} tone="good" active kbd={null} onClick={() => journal.toggleStrength(tag)} />
                ))}
                {otherMistakes.map((tag) => (
                  <TagChip key={tag} tag={tag} tone="bad" active={trade.mistakes.includes(tag)} kbd={mistakeKey(tag)} onClick={() => journal.toggleMistake(tag)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionTitle required={visibleSetups.length > 0} missing={missing.has('Setup')}>Setup</SectionTitle>
        {visibleSetups.length === 0 ? (
          <p className="text-xs text-neutral-600">No setups yet — add them in Settings.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visibleSetups.map((s) => {
              const active = s.id === currentSetupId
              return (
                <button
                  key={s.id}
                  onClick={() => journal.setSetup(active ? null : s)}
                  style={active ? tagChipStyle(s.color) : undefined}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    active ? '' : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                  }`}
                >
                  {s.icon && <span className="mr-1">{s.icon}</span>}
                  {s.name}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <WhatIf key={trade.id} trade={trade} journal={journal} />

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Note</h3>
          <span className="text-[11px] text-neutral-600">{journal.noteSaved ? '' : 'Saving…'}</span>
        </div>
        <textarea
          value={journal.note}
          onChange={(e) => journal.setNote(e.target.value)}
          placeholder="What did you see? What would you do differently?"
          rows={4}
          className="w-full resize-y rounded-lg border border-(--border-strong) bg-(--card-raised) p-3 text-sm text-neutral-100 outline-none focus:border-(--accent)"
        />
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">Screenshot</h3>
        {journal.screenshotUrl ? (
          <div className="relative">
            <img src={journal.screenshotUrl} alt="Trade screenshot" className="w-full rounded-lg border border-(--border)" />
            <button
              onClick={journal.removeScreenshot}
              className="absolute right-2 top-2 rounded-md bg-neutral-950/80 px-2 py-1 text-xs text-neutral-300 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ) : (
          <label className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 text-xs text-neutral-500 hover:border-neutral-500 hover:text-neutral-300">
            {journal.uploading ? 'Uploading…' : 'Paste (Ctrl+V) or click to add'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={journal.uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) journal.uploadScreenshot(file)
              }}
            />
          </label>
        )}
      </section>

      {journal.error && <p className="text-xs text-(--status-critical)">Couldn't save: {journal.error}</p>}
    </div>
  )
}
