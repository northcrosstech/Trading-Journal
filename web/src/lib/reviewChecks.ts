import type { Playbook, TradeWithDetails } from './database.types'
import { strengthsOf } from './strengths'

/** The four decisions of a trade. Fixed -- only the labels under each are editable. */
export const CHECK_SECTIONS = ['Entry', 'Size', 'Stop', 'TP'] as const
export type CheckSection = (typeof CHECK_SECTIONS)[number]

/** Review tags grouped into the four decisions, so a trade reads as a checklist instead
 * of a pile of chips: `good` labels are stored in trades.strengths, `bad` ones in
 * trades.mistakes. `other` holds mistakes that don't belong to one decision. Editable
 * per user in Settings (target_settings.review_checklist). */
export type ReviewChecklist = {
  sections: { label: CheckSection; good: string[]; bad: string[] }[]
  other: string[]
}

export const DEFAULT_CHECKLIST: ReviewChecklist = {
  sections: [
    { label: 'Entry', good: ['Waited for Entry'], bad: ['FOMO', 'Revenge'] },
    { label: 'Size', good: ['Right Size'], bad: ['Oversized'] },
    { label: 'Stop', good: ['Honored Stop', 'Cut Loser Fast'], bad: ['No Stop'] },
    { label: 'TP', good: ['Took Profit at Target', 'Let Winner Run'], bad: ['Exited Early', 'Held Too Long'] },
  ],
  other: ['Broke Max Loss'],
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []

/** Reads a stored checklist defensively: anything missing or malformed falls back to
 * the default for that part, and the four sections always come back in order. */
export function normalizeChecklist(raw: unknown): ReviewChecklist {
  if (!raw || typeof raw !== 'object') return DEFAULT_CHECKLIST
  const r = raw as { sections?: unknown; other?: unknown }
  const stored = Array.isArray(r.sections) ? (r.sections as { label?: unknown; good?: unknown; bad?: unknown }[]) : []
  return {
    sections: DEFAULT_CHECKLIST.sections.map((d) => {
      const s = stored.find((x) => x && x.label === d.label)
      return s ? { label: d.label, good: strList(s.good), bad: strList(s.bad) } : d
    }),
    other: Array.isArray(r.other) ? strList(r.other) : DEFAULT_CHECKLIST.other,
  }
}

/** Every label in the checklist, for duplicate checks. */
export function allLabels(cl: ReviewChecklist): string[] {
  return [...cl.sections.flatMap((s) => [...s.good, ...s.bad]), ...cl.other]
}

/** Keyboard order in the review queue: Shift+1-9 toggles good labels, 1-9 bad ones,
 * in checklist order. */
export function shortcutTags(cl: ReviewChecklist): { good: string[]; bad: string[] } {
  return { good: cl.sections.flatMap((s) => s.good), bad: [...cl.sections.flatMap((s) => s.bad), ...cl.other] }
}

export type CheckResult = { label: string; status: 'good' | 'bad' | null; tags: string[] }

/** A check is bad if any of its mistakes is tagged (a mistake outweighs a done-right
 * in the same area), good if only done-rights are, and null if neither. Mistakes
 * outside the four sections (Other, or labels since removed) come back in
 * `otherMistakes`. */
export function reviewChecks(
  t: { mistakes: string[]; strengths?: string[] | null },
  cl: ReviewChecklist,
): { checks: CheckResult[]; otherMistakes: string[] } {
  const strengths = strengthsOf(t)
  const grouped = new Set<string>(cl.sections.flatMap((c) => c.bad))
  const checks = cl.sections.map((c) => {
    const bad = t.mistakes.filter((m) => c.bad.includes(m))
    const good = strengths.filter((s) => c.good.includes(s))
    return { label: c.label, status: bad.length ? ('bad' as const) : good.length ? ('good' as const) : null, tags: [...bad, ...good] }
  })
  return { checks, otherMistakes: t.mistakes.filter((m) => !grouped.has(m)) }
}

/** Review sections still unanswered, in panel order: whose idea, the four checks, and
 * the setup (only when there are setups to pick from). The review queue warns on Next
 * when this is non-empty, but lets the trader move on anyway. */
export function reviewMissing(t: TradeWithDetails, setups: Pick<Playbook, 'id' | 'archived'>[], cl: ReviewChecklist): string[] {
  const missing: string[] = []
  if (!t.trade_origin) missing.push('Whose idea')
  for (const c of reviewChecks(t, cl).checks) if (!c.status) missing.push(c.label)
  const currentSetupId = t.trade_playbooks?.playbook_id ?? null
  const canPickSetup = setups.some((s) => !s.archived || s.id === currentSetupId)
  if (canPickSetup && !currentSetupId) missing.push('Setup')
  return missing
}
