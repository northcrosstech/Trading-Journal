/** Default emotion vocabulary, seeded lazily (see ensureDefaultEmotions in queries.ts)
 * the first time a user has zero emotions -- keeps this list as the single source of
 * truth rather than duplicating it in a SQL seed, so a future signup gets the same
 * defaults with no migration needed. Order matters: it's the chip display order. */
export const DEFAULT_EMOTIONS: { phase: 'before' | 'during' | 'after'; name: string }[] = [
  { phase: 'before', name: 'Patient' },
  { phase: 'before', name: 'Confident' },
  { phase: 'before', name: 'FOMO' },
  { phase: 'before', name: 'Hesitant' },
  { phase: 'before', name: 'Impulsive' },
  { phase: 'before', name: 'Bored' },
  { phase: 'before', name: 'Chasing' },
  { phase: 'during', name: 'Calm' },
  { phase: 'during', name: 'Anxious' },
  { phase: 'during', name: 'Greedy' },
  { phase: 'during', name: 'Frozen' },
  { phase: 'during', name: 'Second-guessing' },
  { phase: 'during', name: 'In control' },
  { phase: 'after', name: 'Satisfied' },
  { phase: 'after', name: 'Regretful' },
  { phase: 'after', name: 'Relieved' },
  { phase: 'after', name: 'Tilted' },
  { phase: 'after', name: 'Indifferent' },
]

export const PHASES: { phase: 'before' | 'during' | 'after'; label: string }[] = [
  { phase: 'before', label: 'Before' },
  { phase: 'during', label: 'During' },
  { phase: 'after', label: 'After' },
]
