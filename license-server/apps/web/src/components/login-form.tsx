import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'

import { cn } from '#/lib/utils.ts'
import { Button } from '#/components/ui/button.tsx'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field.tsx'
import { Input } from '#/components/ui/input.tsx'

export function LoginForm({
  className,
  onSubmit,
  pending = false,
  error = null,
  ...props
}: Omit<React.ComponentProps<'form'>, 'onSubmit'> & {
  onSubmit: (credentials: { email: string; password: string }) => void
  pending?: boolean
  error?: string | null
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form
      className={cn('flex flex-col gap-6', className)}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ email, password })
      }}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">License Ops sign-in</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Use an admin account to manage licenses and usage.
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="admin@example.com"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="bg-background"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="bg-background pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
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
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
