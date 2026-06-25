import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { Button } from '#/components/ui/button.tsx'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field.tsx'
import { Input } from '#/components/ui/input.tsx'
import { authClient } from '#/lib/auth-client.ts'
import { portalApi } from '#/lib/api.ts'

export const Route = createFileRoute('/signup')({ component: SignupPage })

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  const suffix = Math.random().toString(36).slice(2, 7)
  return `${base || 'org'}-${suffix}`
}

function SignupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', organization: '' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setPending(true)
    setError(null)

    const { error: signUpError } = await authClient.signUp.email({
      email: form.email,
      password: form.password,
      name: form.name,
    })
    if (signUpError) {
      setPending(false)
      setError(signUpError.message ?? 'Unable to create your account.')
      return
    }

    // signUp signs the user in, so we can immediately create their organization.
    const { error: orgError } = await authClient.organization.create({
      name: form.organization,
      slug: slugify(form.organization),
    })
    if (orgError) {
      setPending(false)
      setError(
        orgError.message ??
          'Account created, but we could not set up your organization. Contact support.',
      )
      return
    }

    // Trials are mandatory for new sign-ups — provision one so the portal shows
    // a license immediately. Non-fatal: the portal also offers a "Start trial".
    try {
      await portalApi.startTrial()
    } catch {
      /* portal has a fallback button */
    }
    setPending(false)
    navigate({ to: '/portal' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form className="flex w-full max-w-sm flex-col gap-6" onSubmit={handleSubmit}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold">Create your enterprise account</h1>
            <p className="text-sm text-balance text-muted-foreground">
              Set up your organization to start metering SemPDF usage.
            </p>
          </div>
          <Field>
            <FieldLabel htmlFor="organization">Organization name</FieldLabel>
            <Input
              id="organization"
              required
              placeholder="Acme Inc."
              value={form.organization}
              onChange={(event) => update('organization', event.target.value)}
              className="bg-background"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="name">Your name</FieldLabel>
            <Input
              id="name"
              required
              autoComplete="name"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              className="bg-background"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Work email</FieldLabel>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@acme.com"
              value={form.email}
              onChange={(event) => update('email', event.target.value)}
              className="bg-background"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              className="bg-background"
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Field>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating account…' : 'Create account'}
            </Button>
          </Field>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </FieldGroup>
      </form>
    </div>
  )
}
