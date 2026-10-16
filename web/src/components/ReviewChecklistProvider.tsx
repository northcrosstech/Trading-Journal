import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchTargetSettings, saveReviewChecklist } from '../lib/queries'
import { DEFAULT_CHECKLIST, normalizeChecklist, type ReviewChecklist } from '../lib/reviewChecks'
import { ReviewChecklistContext } from '../lib/reviewChecklistContext'

/** Loads the signed-in user's review checklist once and shares it app-wide (review
 * panel, trade rows, review queue shortcuts, Insights). Until it loads -- or if the
 * user never customized it -- the default list applies. */
export function ReviewChecklistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [checklist, setChecklist] = useState<ReviewChecklist>(DEFAULT_CHECKLIST)

  useEffect(() => {
    let cancelled = false
    fetchTargetSettings()
      .then((s) => {
        if (!cancelled) setChecklist(normalizeChecklist(s?.review_checklist))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const save = useCallback(
    async (next: ReviewChecklist) => {
      if (!user) return
      const previous = checklist
      setChecklist(next)
      try {
        await saveReviewChecklist(user.id, next)
      } catch (e) {
        setChecklist(previous)
        throw e
      }
    },
    [user, checklist],
  )

  const value = useMemo(() => ({ checklist, save }), [checklist, save])
  return <ReviewChecklistContext.Provider value={value}>{children}</ReviewChecklistContext.Provider>
}
