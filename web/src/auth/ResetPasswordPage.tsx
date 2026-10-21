import { useState, type FormEvent } from 'react'
import { LineChart } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

const inputClass = 'rounded-lg border border-(--border-strong) bg-(--card-raised) px-3 py-2 text-neutral-100 outline-none focus:border-(--accent)'

/** Landing page for the password-reset email link. Supabase signs the user in with a
 * short-lived recovery session from the link; this page then sets the new password. */
export function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setError(null)
    setSubmitting(true)
    const { error } = await updatePassword(password)
    setSubmitting(false)
    if (error) {
      setError(error)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--bg) px-4">
      <div className="w-full max-w-sm rounded-2xl border border-(--border) bg-(--card) p-8 shadow-2xl">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-(--accent) text-white shadow-lg">
          <LineChart size={22} />
        </div>
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-white">Set a new password</h1>

        {loading ? (
          <p className="mt-4 text-sm text-neutral-400">Checking your reset link…</p>
        ) : !session ? (
          <div className="mt-4 flex flex-col gap-3 text-sm">
            <p className="text-neutral-400">This reset link is invalid or has expired.</p>
            <Link to="/login" className="text-blue-400 hover:underline">
              Request a new one from the sign-in page
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            <p className="text-sm text-neutral-400">{session.user.email}</p>
            <label className="flex flex-col gap-1.5 text-sm text-neutral-300">
              New password
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-neutral-300">
              Confirm new password
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
              />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-md bg-(--accent) px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
