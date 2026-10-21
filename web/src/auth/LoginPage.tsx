import { useState, type FormEvent } from 'react'
import { LineChart } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function LoginPage() {
  const { signIn, signUp, sendPasswordReset } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signupDone, setSignupDone] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const result =
      mode === 'signin' ? await signIn(email, password) : mode === 'signup' ? await signUp(email, password) : await sendPasswordReset(email)

    setSubmitting(false)
    if (result.error) {
      setError(result.error)
      return
    }
    if (mode === 'reset') {
      setResetSent(true)
      return
    }
    if (mode === 'signup') {
      setSignupDone(true)
      return
    }
    navigate(redirectTo, { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--bg) px-4">
      <div className="w-full max-w-sm rounded-2xl border border-(--border) bg-(--card) p-8 shadow-2xl">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-(--accent) text-white shadow-lg">
          <LineChart size={22} />
        </div>
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-white">Trading Journal</h1>
        <p className="mb-6 text-sm text-neutral-400">
          {mode === 'signin' ? 'Sign in to your journal' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
        </p>

        {signupDone || resetSent ? (
          <div className="rounded-lg border border-emerald-900 bg-emerald-950/50 p-4 text-sm text-emerald-300">
            {resetSent
              ? 'If that email has an account, a reset link is on its way. Open it on this device to set a new password.'
              : 'Check your email to confirm your account, then sign in.'}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm text-neutral-300">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-(--border-strong) bg-(--card-raised) px-3 py-2 text-neutral-100 outline-none focus:border-(--accent)"
              />
            </label>
            {mode !== 'reset' && (
            <label className="flex flex-col gap-1.5 text-sm text-neutral-300">
              Password
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-(--border-strong) bg-(--card-raised) px-3 py-2 text-neutral-100 outline-none focus:border-(--accent)"
              />
            </label>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-md bg-(--accent) px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Sign up' : 'Send reset link'}
            </button>
            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => {
                  setMode('reset')
                  setError(null)
                }}
                className="-mt-1 self-end text-xs text-neutral-500 hover:text-neutral-300"
              >
                Forgot password?
              </button>
            )}
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setSignupDone(false)
            setResetSent(false)
          }}
          className="mt-5 text-sm text-neutral-400 hover:text-neutral-200"
        >
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
