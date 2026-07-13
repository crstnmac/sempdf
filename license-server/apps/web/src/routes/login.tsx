import { useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'

import { LoginForm } from '#/components/login-form.tsx'
import { Logo } from '#/components/logo.tsx'
import { authClient } from '#/lib/auth-client.ts'

/**
 * Reduces a post-login `redirect` to a safe SAME-ORIGIN, path-only target.
 * The value arrives from the URL (attacker-controllable), so an absolute or
 * protocol-relative URL ("https://evil.com", "//evil.com") must never be
 * followed — that would be an open redirect. Returns pathname+search+hash for
 * an in-app destination, or undefined to fall back to role-based routing.
 */
function safeRedirect(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    // Resolve against the current origin; anything pointing elsewhere is dropped.
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return undefined
    const path = `${url.pathname}${url.search}${url.hash}`
    // Must be a single-slash absolute path (reject "//host" style bypasses).
    if (!path.startsWith('/') || path.startsWith('//')) return undefined
    return path
  } catch {
    return undefined
  }
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: '/login' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit({ email, password }: { email: string; password: string }) {
    setPending(true)
    setError(null)
    const { error: signInError } = await authClient.signIn.email({ email, password })
    if (signInError) {
      setPending(false)
      setError(signInError.message ?? 'Unable to sign in. Check your credentials.')
      return
    }
    // Route by role: SaaS maintainers land on the operator portal, org users on
    // their organization portal.
    const { data } = await authClient.getSession()
    setPending(false)
    const target = safeRedirect(redirect)
    if (target) {
      navigate({ to: target })
      return
    }
    navigate({ to: data?.user.role === 'superadmin' ? '/' : '/portal' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Logo className="mx-auto h-8" />
        <LoginForm onSubmit={handleSubmit} pending={pending} error={error} />
        <p className="text-center text-sm text-muted-foreground">
          Need access? Contact your account manager to get set up.
        </p>
      </div>
    </div>
  )
}
