import { createContext, useContext } from 'react'

export type DialogField = {
  name: string
  label: string
  defaultValue?: string
  placeholder?: string
  type?: 'text' | 'number' | 'date' | 'month' | 'select'
  /** For type 'select'. */
  options?: { value: string; label: string }[]
  hint?: string
  /** Leave blank allowed? Default false. */
  optional?: boolean
  /** Return an error message, or null when valid. */
  validate?: (value: string, all: Record<string, string>) => string | null
  /** Prefix shown inside the input, e.g. "$". */
  prefix?: string
}

export type ConfirmOptions = {
  title: string
  message?: string
  confirmLabel?: string
  tone?: 'default' | 'danger' | 'warning'
}

export type FormOptions = {
  title: string
  description?: string
  fields: DialogField[]
  submitLabel?: string
  tone?: 'default' | 'danger' | 'warning'
}

export type DialogApi = {
  /** Resolves true when confirmed, false when cancelled. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  /** Resolves the entered values keyed by field name (trimmed), or null when cancelled. */
  form: (opts: FormOptions) => Promise<Record<string, string> | null>
}

export const DialogContext = createContext<DialogApi | null>(null)

/** In-app replacement for window.confirm / window.prompt. */
export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>')
  return ctx
}

/** Parses "1,234.50" / "$12" style input; null when not a finite number. */
export function parseAmount(raw: string): number | null {
  const t = raw.replace(/[$,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Common validators for dialog fields. */
export const validators = {
  required: (v: string) => (v.trim() === '' ? 'Required' : null),
  nonNegative: (v: string) => {
    if (v.trim() === '') return null
    const n = parseAmount(v)
    return n === null || n < 0 ? 'Enter a number, 0 or more' : null
  },
  positive: (v: string) => {
    const n = parseAmount(v)
    return n === null || n <= 0 ? 'Enter a number above 0' : null
  },
}
