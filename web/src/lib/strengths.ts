/** "Done right" labels live in trades.strengths; which ones are offered is the user's
 * review checklist (lib/reviewChecks.ts). */

/** Until the strengths migration is applied the column is absent, so read defensively. */
export function strengthsOf(t: { strengths?: string[] | null }): string[] {
  return t.strengths ?? []
}
