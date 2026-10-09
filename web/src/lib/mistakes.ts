/** The fixed mistake vocabulary for trade review. Deliberately short and fixed (not
 * user-managed): a small set is fast to tag honestly, and a stable set is what makes
 * "cost of mistakes" comparable month to month. Stored as text in trades.mistakes. */
export const MISTAKE_TAGS = ['FOMO', 'Oversized', 'No Stop', 'Revenge', 'Exited Early', 'Held Too Long', 'Broke Max Loss'] as const

export type MistakeTag = (typeof MISTAKE_TAGS)[number]
