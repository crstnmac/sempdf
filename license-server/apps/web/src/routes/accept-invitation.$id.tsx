import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { EyeIcon, EyeOffIcon } from 'lucide-react'

import { Logo } from '#/components/logo.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field.tsx'
import { Input } from '#/components/ui/input.tsx'
import { authClient } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/accept-invitation/$id')({
  component: AcceptInvitationPage,
})

interface Invitation {
  organizationName: string
  role: string
  email: string
}

type Phase = 'checking' | 'auth' | 'confirm' | 'accepting'

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

/** Maps better-auth invitation errors to copy a recipient can act on. */
function readableInviteError(message?: string): string {
  const m = (message ?? '').toLowerCase()
  if (m.includes('recipient')) {
    return 'This invitation was sent to a different email address. Sign out and sign in with the invited address.'
  }
  if (m.includes('not found') || m.includes('expired')) {
    return 'This invitation is no longer valid — it may have expired or already been used. Ask your admin to send a new one.'
  }
  return message ?? 'Could not load this invitation.'
}

function AcceptInvitationPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('checking')
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)

  async function loadInvitation() {
    const { data, error: inviteError } = await authClient.organization.getInvitation({
      query: { id },
    })
    if (inviteError || !data) {
      setInvitation(null)
      setError(readableInviteError(inviteError?.message))
    } else {
      setInvitation({
        organizationName: data.organizationName,
        role: data.role,
        email: data.email,
      })
      setError(null)
    }
    setPhase('confirm')
  }

  // Already signed in? Skip straight to the confirmation step.
  useEffect(() => {
    let active = true
    void (async () => {
      const { data } = await authClient.getSession()
      if (!active) return
      if (data) await loadInvitation()
      else setPhase('auth')
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleAuth(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const result =
      mode === 'signup'
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password })
    setPending(false)
    if (result.error) {
      setError(result.error.message ?? 'Authentication failed. Check your details and try again.')
      return
    }
    await loadInvitation()
  }

  async function handleAccept() {
    setPhase('accepting')
    setError(null)
    const { error: acceptErr } = await authClient.organization.acceptInvitation({
      invitationId: id,
    })
    if (acceptErr) {
      setError(readableInviteError(acceptErr.message))
      setPhase('confirm')
      return
    }
    toast.success(`You've joined ${invitation?.organizationName ?? 'the organization'}.`)
    navigate({ to: '/portal' })
  }

  async function handleSignOut() {
    await authClient.signOut()
    setInvitation(null)
    setError(null)
    setEmail('')
    setPassword('')
    setName('')
    setMode('signin')
    setPhase('auth')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Logo className="mx-auto h-8" />

        {phase === 'checking' ? (
          <p className="text-center text-sm text-muted-foreground">Loading invitation…</p>
        ) : null}

        {phase === 'auth' ? (
          <form className="flex flex-col gap-6" onSubmit={handleAuth}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-1 text-center">
                <h1 className="text-2xl font-bold">Accept your invitation</h1>
                <p className="text-sm text-balance text-muted-foreground">
                  {mode === 'signup'
                    ? 'Create your account to join the organization.'
                    : 'Sign in to join the organization.'}
                </p>
              </div>
              {mode === 'signup' ? (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input
                    id="name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-background"
                  />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-background pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
              </Field>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Field>
                <Button type="submit" disabled={pending}>
                  {pending
                    ? 'Please wait…'
                    : mode === 'signup'
                      ? 'Create account & continue'
                      : 'Sign in & continue'}
                </Button>
              </Field>
            </FieldGroup>
            <p className="text-center text-sm text-muted-foreground">
              {mode === 'signup' ? 'Already have an account?' : 'Need an account?'}{' '}
              <button
                type="button"
                className="font-medium text-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setMode((mo) => (mo === 'signup' ? 'signin' : 'signup'))
                  setError(null)
                }}
              >
                {mode === 'signup' ? 'Sign in' : 'Create one'}
              </button>
            </p>
          </form>
        ) : null}

        {phase === 'confirm' || phase === 'accepting' ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-center">
            {invitation ? (
              <>
                <div className="flex flex-col gap-1">
                  <h1 className="font-heading text-xl font-semibold text-foreground">
                    Join {invitation.organizationName}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    You've been invited as {article(invitation.role)}{' '}
                    <strong>{invitation.role}</strong>.
                  </p>
                </div>
                <Button onClick={handleAccept} disabled={phase === 'accepting'}>
                  {phase === 'accepting' ? 'Joining…' : 'Accept invitation'}
                </Button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={handleSignOut}
                >
                  Not you? Sign out
                </button>
              </>
            ) : (
              <>
                <h1 className="font-heading text-xl font-semibold text-foreground">
                  Invitation unavailable
                </h1>
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" onClick={handleSignOut}>
                  Sign in with a different account
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
