import { createContext, useContext } from 'react'
import { DEFAULT_CHECKLIST, type ReviewChecklist } from './reviewChecks'

export type ReviewChecklistContextValue = {
  checklist: ReviewChecklist
  /** Saves for the signed-in user; the new list applies everywhere immediately. */
  save: (next: ReviewChecklist) => Promise<void>
}

export const ReviewChecklistContext = createContext<ReviewChecklistContextValue>({
  checklist: DEFAULT_CHECKLIST,
  save: async () => {},
})

export function useReviewChecklist(): ReviewChecklistContextValue {
  return useContext(ReviewChecklistContext)
}
