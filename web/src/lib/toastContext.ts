import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'
/** A button inside the toast, e.g. Undo. Pressing it also dismisses the toast. */
export type ToastAction = { label: string; onClick: () => void }
export type ToastApi = (message: string, tone?: ToastTone, action?: ToastAction) => void

export const ToastContext = createContext<ToastApi>(() => {})

/** Shows a short notification bottom-right, e.g. toast('Bought 10 VOO'). Pass an action for
 * a one-click follow-up: toast('Marked paid', 'success', { label: 'Undo', onClick }). */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
