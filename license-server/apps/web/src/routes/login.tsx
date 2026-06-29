import { useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'

import { LoginForm } from '#/components/login-form.tsx'
import { authClient } from '#/lib/auth-client.ts'

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
    if (redirect) {
      navigate({ to: redirect })
      return
    }
    navigate({ to: data?.user.role === 'superadmin' ? '/' : '/portal' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <LoginForm onSubmit={handleSubmit} pending={pending} error={error} />
        <p className="text-center text-sm text-muted-foreground">
          Need access? Contact your account manager to get set up.
        </p>
      </div>
    </div>
  )
}
