import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { SiteHeader } from '#/components/site-header.tsx'
import { PageContainer } from '#/components/page-shell.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { authClient, useSession } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/portal/account')({ component: AccountPage })

function AccountPage() {
  const { data: session } = useSession()
  const user = session?.user

  return (
    <>
      <SiteHeader title="Account" />
      <PageContainer>
        <div className="flex max-w-2xl flex-col gap-6">
          <ProfileCard initialName={user?.name ?? ''} email={user?.email ?? ''} />
          <PasswordCard />
        </div>
      </PageContainer>
    </>
  )
}

function ProfileCard({ initialName, email }: { initialName: string; email: string }) {
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)

  // Re-seed when the session resolves after first render.
  useEffect(() => {
    setName(initialName)
  }, [initialName])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      toast.error('Name cannot be empty.')
      return
    }
    setSaving(true)
    try {
      const { error } = await authClient.updateUser({ name: name.trim() })
      if (error) throw new Error(error.message ?? 'Could not update profile.')
      toast.success('Profile updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name and sign-in email.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={save}>
          <div className="grid gap-1.5">
            <Label htmlFor="acct-name">Name</Label>
            <Input id="acct-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="acct-email">Email</Label>
            <Input id="acct-email" type="email" value={email} disabled />
            <p className="text-xs text-muted-foreground">
              Contact your account manager to change your sign-in email.
            </p>
          </div>
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (next.length < 8) {
      toast.error('New password must be at least 8 characters.')
      return
    }
    if (next !== confirm) {
      toast.error('New password and confirmation do not match.')
      return
    }
    setSaving(true)
    try {
      const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      })
      if (error) throw new Error(error.message ?? 'Could not change password.')
      toast.success('Password changed. Other sessions were signed out.')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Change your password. If you signed in with a temporary password from onboarding, set your
          own here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={save}>
          <div className="grid gap-1.5">
            <Label htmlFor="cur-pw">Current password</Label>
            <Input
              id="cur-pw"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <Input
              id="new-pw"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-pw">Confirm new password</Label>
            <Input
              id="confirm-pw"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Change password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
