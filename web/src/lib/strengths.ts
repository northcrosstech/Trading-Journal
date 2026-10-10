/** The fixed "done right" vocabulary for trade review -- each one is the habit that
 * prevents a mistake in MISTAKE_TAGS, so reviews reinforce good process, not just
 * catalogue errors. Stored as text in trades.strengths. */
export const STRENGTH_TAGS = [
  'Waited for Entry',
  'Right Size',
  'Honored Stop',
  'Took Profit at Target',
  'Let Winner Run',
  'Cut Loser Fast',
] as const

/** Until the strengths migration is applied the column is absent, so read defensively. */
export function strengthsOf(t: { strengths?: string[] | null }): string[] {
  return t.strengths ?? []
}
