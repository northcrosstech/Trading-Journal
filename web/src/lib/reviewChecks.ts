import { strengthsOf } from './strengths'

/** The review tags regrouped into the four decisions of a trade, so a trade list reads
 * as a checklist instead of a pile of chips. Each done-right tag has its mistake
 * opposite in the same row. */
export const REVIEW_CHECKS = [
  { label: 'Entry', good: ['Waited for Entry'], bad: ['FOMO', 'Revenge'] },
  { label: 'Size', good: ['Right Size'], bad: ['Oversized'] },
  { label: 'Stop', good: ['Honored Stop', 'Cut Loser Fast'], bad: ['No Stop', 'Held Too Long'] },
  { label: 'TP', good: ['Took Profit at Target', 'Let Winner Run'], bad: ['Exited Early'] },
] as const

export type CheckResult = { label: string; status: 'good' | 'bad' | null; tags: string[] }

/** A check is bad if any of its mistakes is tagged (a mistake outweighs a done-right
 * in the same area), good if only done-rights are, and null if neither. Mistakes
 * outside the four areas (e.g. Broke Max Loss, legacy free-form tags) come back in
 * `otherMistakes`. */
export function reviewChecks(t: { mistakes: string[]; strengths?: string[] | null }): {
  checks: CheckResult[]
  otherMistakes: string[]
} {
  const strengths = strengthsOf(t)
  const grouped = new Set<string>(REVIEW_CHECKS.flatMap((c) => c.bad))
  const checks = REVIEW_CHECKS.map((c) => {
    const bad = t.mistakes.filter((m) => (c.bad as readonly string[]).includes(m))
    const good = strengths.filter((s) => (c.good as readonly string[]).includes(s))
    return { label: c.label, status: bad.length ? ('bad' as const) : good.length ? ('good' as const) : null, tags: [...bad, ...good] }
  })
  return { checks, otherMistakes: t.mistakes.filter((m) => !grouped.has(m)) }
}
