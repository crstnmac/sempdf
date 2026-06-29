import { useState } from 'react'
import { toast } from 'sonner'
import { CopyIcon, UserPlusIcon } from 'lucide-react'

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
import { ANNUAL_TIERS, ApiError, api } from '#/lib/api.ts'

/**
 * Plan choices for a new customer: a Trial sized to a custom page count (the
 * usual onboarding case) plus the standard annual tiers (so Sales can hand out a
 * trial already sized to the plan the customer intends to buy). `limit: null`
 * means "type an exact number".
 */
const PLAN_OPTIONS: { label: string; limit: number | null }[] = [
  { label: 'Trial (custom pages)', limit: null },
  ...ANNUAL_TIERS,
]

/** Default trial expiry: 15 days out, as a yyyy-mm-dd string for the date input. */
function defaultExpiry(): string {
  const d = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

/** One year from today (annual plan renewal date), as a yyyy-mm-dd string. */
function oneYearOut(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

type Result = {
  customerEmail: string
  temporaryPassword: string
  key: string
  orgName: string
}

/**
 * Sales onboarding flow: create a customer (organization + owner user + trial
 * license) and reveal the API key + temporary password once for Sales to relay.
 */
export function NewCustomerSheet({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [tierIndex, setTierIndex] = useState('0')
  const [customLimit, setCustomLimit] = useState('1000')
  const [expiry, setExpiry] = useState(defaultExpiry())
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const tier = PLAN_OPTIONS[Number(tierIndex)] ?? PLAN_OPTIONS[0]!
  const isTrial = Number(tierIndex) === 0
  const isCustomTier = tier.limit === null
  const resolvedLimit = isCustomTier ? Number(customLimit) : tier.limit!

  function reset() {
    setOrgName('')
    setCustomerName('')
    setCustomerEmail('')
    setTierIndex('0')
    setCustomLimit('1000')
    setExpiry(defaultExpiry())
    setResult(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!orgName.trim() || !customerName.trim() || !customerEmail.trim()) {
      toast.error('Company, contact name, and customer email are required.')
      return
    }
    if (!Number.isFinite(resolvedLimit) || resolvedLimit <= 0) {
      toast.error('Enter a positive page limit.')
      return
    }
    if (isTrial && !expiry) {
      toast.error('Set a trial expiry date.')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.createCustomer({
        orgName: orgName.trim(),
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        kind: isTrial ? 'trial' : 'paid',
        limit: resolvedLimit,
        window: 'year',
        ...(isTrial ? { trialEndsAt: new Date(expiry).toISOString() } : {}),
      })
      setResult({
        customerEmail: res.customerEmail,
        temporaryPassword: res.temporaryPassword,
        key: res.key,
        orgName: res.organization.name,
      })
      toast.success('Customer created. Share the credentials below — shown once.')
      onCreated()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create customer.')
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
      <SheetTrigger render={<Button size="sm" />}>
        <UserPlusIcon />
        New customer
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New customer</SheetTitle>
          <SheetDescription>
            Create the customer’s organization, owner login, and a license — a trial (with an expiry
            date) or a paid annual plan. The API key and a temporary password are shown once — relay
            them to the customer.
          </SheetDescription>
        </SheetHeader>

        {result ? (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <p className="text-sm text-muted-foreground">
              Customer <strong>{result.orgName}</strong> created. Copy these now — for security they
              are shown only once.
            </p>
            <CopyField label="Customer email (login)" value={result.customerEmail} />
            <CopyField label="Temporary password" value={result.temporaryPassword} />
            <CopyField label="API key" value={result.key} />
            <p className="text-xs text-muted-foreground">
              The customer signs in at the dashboard with the email + temporary password and should
              change it after first login.
            </p>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <form className="flex flex-1 flex-col gap-4 overflow-y-auto p-4" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="orgName">Company</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                placeholder="Acme Inc."
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="customerName">Contact name</Label>
              <Input
                id="customerName"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Jane Doe"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="customerEmail">Customer email</Label>
              <Input
                id="customerEmail"
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                placeholder="jane@acme.com"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="tier">Plan</Label>
              <Select value={tierIndex} onValueChange={(v) => setTierIndex(v ?? '0')}>
                <SelectTrigger id="tier">
                  <SelectValue>{tier.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map((t, i) => (
                    <SelectItem key={t.label} value={String(i)}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isCustomTier ? (
              <div className="grid gap-1.5">
                <Label htmlFor="customLimit">
                  {Number(tierIndex) === 0 ? 'Trial page limit' : 'Custom annual page limit'}
                </Label>
                <Input
                  id="customLimit"
                  type="number"
                  min={1}
                  value={customLimit}
                  onChange={(event) => setCustomLimit(event.target.value)}
                />
              </div>
            ) : null}

            {isTrial ? (
              <div className="grid gap-1.5">
                <Label htmlFor="expiry">Trial expiry date</Label>
                <Input
                  id="expiry"
                  type="date"
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                />
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="plan-expiry">Plan expiry date</Label>
                <Input id="plan-expiry" type="date" value={oneYearOut()} disabled />
                <p className="text-xs text-muted-foreground">Annual plan — renews one year from today.</p>
              </div>
            )}

            <SheetFooter className="px-0">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create customer'}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-border bg-muted-surface px-3 py-2 text-sm break-all">
          {value}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(value)
            toast.success('Copied.')
          }}
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  )
}
