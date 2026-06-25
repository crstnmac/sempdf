import { useState } from 'react'
import { toast } from 'sonner'
import { CopyIcon, PlusIcon } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet.tsx'
import { useAsync } from '#/hooks/use-async.ts'
import { ApiError, type UsageWindow, api } from '#/lib/api.ts'

/**
 * Operator flow for issuing a new license. Trials are mandatory for new
 * customers, so the form defaults to a date-bound trial with a grace period;
 * the resulting key is revealed once.
 */
export function IssueLicenseSheet({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const orgs = useAsync(() => api.organizations(), [open])

  const [accountId, setAccountId] = useState('')
  const [limit, setLimit] = useState('10000')
  const [window, setWindow] = useState<UsageWindow>('month')
  const [trialDays, setTrialDays] = useState('15')
  const [gracePeriodDays, setGracePeriodDays] = useState('7')
  const [failMode, setFailMode] = useState<'closed' | 'open'>('closed')
  const [submitting, setSubmitting] = useState(false)
  const [issuedKey, setIssuedKey] = useState<string | null>(null)

  function reset() {
    setAccountId('')
    setLimit('10000')
    setWindow('month')
    setTrialDays('15')
    setGracePeriodDays('7')
    setFailMode('closed')
    setIssuedKey(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!accountId) {
      toast.error('Select an organization.')
      return
    }
    setSubmitting(true)
    try {
      const created = await api.createLicense({
        accountId,
        limit: Number(limit),
        window,
        trialDays: Number(trialDays),
        gracePeriodDays: Number(gracePeriodDays),
        failMode,
      })
      setIssuedKey(created.key)
      toast.success('License issued. Copy the key — it is shown once.')
      onCreated()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not issue license.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          Issue license
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Issue license</SheetTitle>
          <SheetDescription>
            Create a date-bound trial license. Output is watermarked during the trial and after
            overage; a hard block follows the grace period.
          </SheetDescription>
        </SheetHeader>

        {issuedKey ? (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <p className="text-sm text-muted-foreground">
              License created. Copy the key now — for security it is shown only once.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-border bg-muted-surface px-3 py-2 text-sm break-all">
                {issuedKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(issuedKey)
                  toast.success('Copied.')
                }}
              >
                <CopyIcon />
              </Button>
            </div>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <form className="flex flex-1 flex-col gap-4 overflow-y-auto p-4" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="org">Organization</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="org">
                  <SelectValue placeholder={orgs.loading ? 'Loading…' : 'Select an organization'} />
                </SelectTrigger>
                <SelectContent>
                  {(orgs.data?.organizations ?? []).map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} · {org.licenseCount} license(s)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="limit">Page limit</Label>
                <Input
                  id="limit"
                  type="number"
                  min={0}
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="window">Window</Label>
                <Select value={window} onValueChange={(value) => setWindow(value as UsageWindow)}>
                  <SelectTrigger id="window">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="day">Daily</SelectItem>
                    <SelectItem value="lifetime">Lifetime</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="trialDays">Trial days</Label>
                <Input
                  id="trialDays"
                  type="number"
                  min={0}
                  value={trialDays}
                  onChange={(event) => setTrialDays(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="grace">Grace period days</Label>
                <Input
                  id="grace"
                  type="number"
                  min={0}
                  value={gracePeriodDays}
                  onChange={(event) => setGracePeriodDays(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="failMode">Fail mode (server unreachable)</Label>
              <Select value={failMode} onValueChange={(value) => setFailMode(value as 'closed' | 'open')}>
                <SelectTrigger id="failMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="closed">Closed — refuse new leases</SelectItem>
                  <SelectItem value="open">Open — short grace lease</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <SheetFooter className="px-0">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Issuing…' : 'Issue license'}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
