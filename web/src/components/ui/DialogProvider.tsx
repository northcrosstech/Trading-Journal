import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { DialogContext, type ConfirmOptions, type FormOptions } from '../../lib/dialogContext'
import { INPUT, LABEL } from '../../lib/ui'
import { Button } from './Button'

type Pending =
  | { kind: 'confirm'; id: number; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'form'; id: number; opts: FormOptions; resolve: (v: Record<string, string> | null) => void }

function FormBody({
  opts,
  onSubmit,
  onCancel,
  onBusy,
}: {
  opts: FormOptions
  onSubmit: (v: Record<string, string>) => void
  onCancel: () => void
  /** Tells the host a save is running, so Esc or a click outside can't drop it. */
  onBusy: (busy: boolean) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(opts.fields.map((f) => [f.name, f.defaultValue ?? ''])),
  )
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function submit() {
    if (busy) return
    const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]))
    const next: Record<string, string | null> = {}
    for (const f of opts.fields) {
      const v = trimmed[f.name] ?? ''
      next[f.name] = !f.optional && v === '' ? 'Required' : (f.validate?.(v, trimmed) ?? null)
    }
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    if (!opts.onSubmit) return onSubmit(trimmed)
    // The caller saves from inside the dialog: stay open until it has worked.
    setFailure(null)
    setBusy(true)
    onBusy(true)
    try {
      await opts.onSubmit(trimmed)
    } catch (e) {
      if (!mounted.current) return
      onBusy(false)
      setBusy(false)
      setFailure(e instanceof Error ? e.message : String(e))
      return
    }
    if (!mounted.current) return
    onBusy(false)
    onSubmit(trimmed)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-4"
    >
      {opts.description && <p className="text-sm text-neutral-400">{opts.description}</p>}
      {opts.fields.map((f, i) => (
        <label key={f.name} className="flex flex-col gap-1.5">
          <span className={LABEL}>
            {f.label}
            {f.optional && <span className="font-normal text-neutral-600"> (optional)</span>}
          </span>
          <span className="relative">
            {f.prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">{f.prefix}</span>}
            {f.type === 'select' ? (
              <select
                autoFocus={i === 0}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className={INPUT}
              >
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
            <input
              autoFocus={i === 0}
              type={f.type === 'date' || f.type === 'month' ? f.type : 'text'}
              inputMode={f.type === 'number' ? 'decimal' : undefined}
              value={values[f.name] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              className={`${INPUT} ${f.prefix ? 'pl-7' : ''} ${errors[f.name] ? 'border-red-500/70' : ''}`}
            />
            )}
          </span>
          {errors[f.name] ? (
            <span className="text-xs text-red-400">{errors[f.name]}</span>
          ) : (
            f.hint && <span className="text-xs text-neutral-500">{f.hint}</span>
          )}
        </label>
      ))}
      {failure && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {failure}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant={opts.tone === 'danger' ? 'danger' : 'primary'} disabled={busy}>
          {busy ? 'Saving…' : (opts.submitLabel ?? 'Save')}
        </Button>
      </div>
    </form>
  )
}

/** Hosts the app's confirm / form dialogs (see lib/dialogContext.ts). One dialog at a time. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const nextId = useRef(1)
  // True while a form's own save is running: the dialog can't be dismissed until it ends.
  const busyRef = useRef(false)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  const close = useCallback((result: unknown, force = false) => {
    const p = pendingRef.current
    if (!p || (busyRef.current && !force)) return
    if (p.kind === 'confirm') p.resolve(Boolean(result))
    else p.resolve((result as Record<string, string> | null) ?? null)
    setPending(null)
  }, [])

  // A new dialog replaces any open one; the replaced one resolves as cancelled.
  const cancelOpen = useCallback(() => {
    const p = pendingRef.current
    if (!p) return
    if (p.kind === 'confirm') p.resolve(false)
    else p.resolve(null)
    busyRef.current = false
  }, [])

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        cancelOpen()
        setPending({ kind: 'confirm', id: nextId.current++, opts, resolve })
      }),
    [cancelOpen],
  )
  const form = useCallback(
    (opts: FormOptions) =>
      new Promise<Record<string, string> | null>((resolve) => {
        cancelOpen()
        setPending({ kind: 'form', id: nextId.current++, opts, resolve })
      }),
    [cancelOpen],
  )

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(pending.kind === 'confirm' ? false : null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close])

  const api = useMemo(() => ({ confirm, form }), [confirm, form])
  const tone = pending?.opts.tone ?? 'default'

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="ui-fade-in absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => close(pending.kind === 'confirm' ? false : null)} />
            <div role="dialog" aria-modal="true" className="ui-pop-in relative w-full max-w-sm rounded-2xl border border-(--border) bg-(--card) p-5 shadow-2xl">
              <div className="mb-3 flex items-start gap-3">
                {tone !== 'default' && (
                  <div className={`rounded-xl p-2 ${tone === 'danger' ? 'bg-red-500/12 text-red-300' : 'bg-amber-500/12 text-amber-300'}`}>
                    <AlertTriangle size={18} />
                  </div>
                )}
                <h2 className="pt-1 text-base font-semibold text-white">{pending.opts.title}</h2>
              </div>
              {pending.kind === 'confirm' ? (
                <>
                  {pending.opts.message && <p className="text-sm text-neutral-400">{pending.opts.message}</p>}
                  <div className="mt-5 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => close(false)}>
                      Cancel
                    </Button>
                    <Button autoFocus variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
                      {pending.opts.confirmLabel ?? 'Confirm'}
                    </Button>
                  </div>
                </>
              ) : (
                <FormBody
                  key={pending.id}
                  opts={pending.opts}
                  onSubmit={(v) => close(v, true)}
                  onCancel={() => close(null)}
                  onBusy={(b) => {
                    busyRef.current = b
                  }}
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </DialogContext.Provider>
  )
}
