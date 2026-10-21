import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { ToastContext, type ToastTone } from '../../lib/toastContext'

type Toast = { id: number; message: string; tone: ToastTone }

const ICON = { success: CheckCircle2, error: XCircle, info: Info }
const COLOR = { success: 'text-emerald-400', error: 'text-red-400', info: 'text-sky-400' }

/** Bottom-right notifications confirming an action ("Bought 10 VOO") or reporting a
 * failure. Success/info fade after 3.5s; errors stay 7s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-3), { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
          {toasts.map((t) => {
            const Icon = ICON[t.tone]
            return (
              <div
                key={t.id}
                role="status"
                className="ui-pop-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-(--border-strong) bg-(--card-raised) px-3.5 py-3 text-sm text-neutral-100 shadow-2xl"
              >
                <Icon size={18} className={`mt-px shrink-0 ${COLOR[t.tone]}`} />
                <span className="min-w-0">{t.message}</span>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
