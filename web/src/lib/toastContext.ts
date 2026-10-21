import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'
export type ToastApi = (message: string, tone?: ToastTone) => void

export const ToastContext = createContext<ToastApi>(() => {})

/** Shows a short notification bottom-right, e.g. toast('Bought 10 VOO'). */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
