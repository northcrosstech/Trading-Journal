import { useCallback, useEffect, useRef, useState } from 'react'
import type { Playbook, TradeWithDetails } from './database.types'
import {
  updateTradeJournal,
  setTradePlaybook,
  removeTradePlaybook,
  uploadTradeScreenshot,
  updateTradeScreenshot,
  getTradeScreenshotUrl,
  deleteTradeScreenshot,
} from './queries'

export type TradeUpdater = (tradeId: string, update: (t: TradeWithDetails) => TradeWithDetails) => void

/** All of a trade's review state and its persistence, in one place -- the trade page
 * and the review queue both drive it (the queue adds keyboard shortcuts on top).
 * Every change saves immediately (the note is debounced), so nothing is ever lost by
 * moving on to the next trade. Pasting an image anywhere on the page attaches it as
 * the trade's screenshot. */
export function useTradeJournal(trade: TradeWithDetails | null, userId: string | undefined, updateTrade: TradeUpdater) {
  const tradeId = trade?.id ?? null
  const [note, setNoteState] = useState('')
  const [noteSaved, setNoteSaved] = useState(true)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed local note state only when switching trades, not on every trade update
  // (the ref lets the effect read the latest notes without depending on them).
  const latestNotes = useRef(trade?.notes ?? '')
  latestNotes.current = trade?.notes ?? ''
  useEffect(() => {
    setNoteState(latestNotes.current)
    setNoteSaved(true)
    setError(null)
  }, [tradeId])

  const screenshotPath = trade?.screenshot_url ?? null
  useEffect(() => {
    let cancelled = false
    setScreenshotUrl(null)
    if (screenshotPath) {
      getTradeScreenshotUrl(screenshotPath)
        .then((url) => !cancelled && setScreenshotUrl(url))
        .catch(() => !cancelled && setScreenshotUrl(null))
    }
    return () => {
      cancelled = true
    }
  }, [screenshotPath])

  const run = useCallback((p: Promise<unknown>) => {
    p.catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const setPlanned = useCallback(
    (planned: boolean | null) => {
      if (!tradeId) return
      updateTrade(tradeId, (t) => ({ ...t, planned }))
      run(updateTradeJournal(tradeId, { planned }))
    },
    [tradeId, updateTrade, run],
  )

  const toggleTag = useCallback(
    (field: 'mistakes' | 'strengths', tag: string) => {
      if (!trade) return
      const current = trade[field] ?? []
      const next = current.includes(tag) ? current.filter((m) => m !== tag) : [...current, tag]
      updateTrade(trade.id, (t) => ({ ...t, [field]: next }))
      run(updateTradeJournal(trade.id, { [field]: next }))
    },
    [trade, updateTrade, run],
  )
  const toggleMistake = useCallback((tag: string) => toggleTag('mistakes', tag), [toggleTag])
  const toggleStrength = useCallback((tag: string) => toggleTag('strengths', tag), [toggleTag])

  /** Stop / target / alt-exit price (option premium); null clears it. */
  const setPrice = useCallback(
    (field: 'stop_price' | 'target_price' | 'alt_exit_price', value: number | null) => {
      if (!tradeId) return
      updateTrade(tradeId, (t) => ({ ...t, [field]: value }))
      run(updateTradeJournal(tradeId, { [field]: value }))
    },
    [tradeId, updateTrade, run],
  )

  const setSetup = useCallback(
    (playbook: Playbook | null) => {
      if (!tradeId) return
      updateTrade(tradeId, (t) => ({
        ...t,
        trade_playbooks: playbook ? { playbook_id: playbook.id, playbooks: playbook } : null,
      }))
      run(playbook ? setTradePlaybook(tradeId, playbook.id) : removeTradePlaybook(tradeId))
    },
    [tradeId, updateTrade, run],
  )

  const setNote = useCallback(
    (value: string) => {
      if (!tradeId) return
      setNoteState(value)
      setNoteSaved(false)
      if (noteTimer.current) clearTimeout(noteTimer.current)
      // tradeId is captured here, so moving to the next trade mid-debounce still saves
      // to the right trade.
      noteTimer.current = setTimeout(() => {
        updateTrade(tradeId, (t) => ({ ...t, notes: value }))
        updateTradeJournal(tradeId, { notes: value })
          .then(() => setNoteSaved(true))
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      }, 600)
    },
    [tradeId, updateTrade],
  )

  const uploadScreenshot = useCallback(
    async (file: File) => {
      if (!tradeId || !userId) return
      setUploading(true)
      try {
        const path = await uploadTradeScreenshot(userId, tradeId, file)
        await updateTradeScreenshot(tradeId, path)
        updateTrade(tradeId, (t) => ({ ...t, screenshot_url: path }))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setUploading(false)
      }
    },
    [tradeId, userId, updateTrade],
  )

  const removeScreenshot = useCallback(async () => {
    if (!tradeId || !screenshotPath) return
    await deleteTradeScreenshot(screenshotPath)
    await updateTradeScreenshot(tradeId, null)
    updateTrade(tradeId, (t) => ({ ...t, screenshot_url: null }))
  }, [tradeId, screenshotPath, updateTrade])

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      uploadScreenshot(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadScreenshot])

  return {
    note,
    noteSaved,
    setNote,
    setPlanned,
    toggleMistake,
    toggleStrength,
    setPrice,
    setSetup,
    screenshotUrl,
    uploading,
    uploadScreenshot,
    removeScreenshot,
    error,
  }
}

export type TradeJournal = ReturnType<typeof useTradeJournal>
