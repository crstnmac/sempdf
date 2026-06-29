import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeftIcon } from 'lucide-react'

import { SiteHeader } from '#/components/site-header.tsx'
import {
  PageContainer,
  StateNotice,
  StatusBadge,
  TelemetryBadge,
  UsageMeter,
  WatermarkBadge,
} from '#/components/page-shell.tsx'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table.tsx'
import { useAsync } from '#/hooks/use-async.ts'
import {
  ANNUAL_TIERS,
  ApiError,
  type LicenseUsage,
  type UsageWindow,
  api,
  formatDate,
  formatDateTime,
  formatLimit,
  formatNumber,
  isUnlimited,
  relativeDays,
} from '#/lib/api.ts'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'

export const Route = createFileRoute('/_admin/licenses/$id')({ component: LicenseDetailPage })

function LicenseDetailPage() {
  const { id } = Route.useParams()
  const { data, loading, error, refetch } = useAsync(() => api.licenseUsage(id), [id])

  const [trialDays, setTrialDays] = useState('15')
  const [trialPages, setTrialPages] = useState('1000')
  const [pagesMode, setPagesMode] = useState<'one_time' | 'recurring'>('one_time')
  const [busy, setBusy] = useState<null | 'extend' | 'pages' | 'rotate' | 'revoke'>(null)
  const [rotatedKey, setRotatedKey] = useState<string | null>(null)

  async function run(action: 'extend' | 'pages' | 'rotate' | 'revoke', fn: () => Promise<unknown>) {
    setBusy(action)
    try {
      await fn()
      refetch()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Action failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <SiteHeader
        title="License detail"
        actions={
          <Button render={<Link to="/licenses" />} nativeButton={false} variant="ghost" size="sm">
            <ArrowLeftIcon />
            Back
          </Button>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice title="Loading license" message="Fetching license usage from the API." />
        ) : error ? (
          <StateNotice title="License unavailable" message={error} tone="warning" onRetry={refetch} />
        ) : data ? (
          <>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle>{data.organizationName}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <WatermarkBadge status={data.status} />
                  <StatusBadge status={data.status} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <UsageMeter used={data.used} limit={data.limit} />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat
                    label={data.remaining < 0 ? 'Overage' : 'Remaining'}
                    value={
                      isUnlimited(data.limit)
                        ? '∞'
                        : data.remaining < 0
                          ? `${formatNumber(-data.remaining)} over`
                          : formatNumber(data.remaining)
                    }
                  />
                  <Stat label="Metric" value={data.metric} />
                  <Stat
                    label="Trial ends"
                    value={formatDate(data.trialEndsAt)}
                    hint={data.trialEndsAt ? relativeDays(data.trialEndsAt) : undefined}
                  />
                  <Stat
                    label="Limit reached"
                    value={formatDate(data.firstOverageAt)}
                    hint={data.firstOverageAt ? relativeDays(data.firstOverageAt) : undefined}
                  />
                </div>
                {data.status === 'hard_blocked' ? (
                  <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">
                    Hard blocked — all new runs are rejected until payment/renewal.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChangePlanCard data={data} onChanged={refetch} />

              {data.trialEndsAt ? (
              <Card>
                <CardHeader>
                  <CardTitle>Extend trial</CardTitle>
                  <CardDescription>
                    Push the trial end date out, or grant more pages. Either resets overage state and
                    reactivates a hard-blocked license.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <form
                    className="flex items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const days = Number(trialDays)
                      if (!Number.isFinite(days) || days <= 0) {
                        toast.error('Enter a positive number of days.')
                        return
                      }
                      if (
                        !window.confirm(
                          `Extend the trial for ${data.organizationName} by ${days} day${days === 1 ? '' : 's'}?\n\n` +
                            'This moves the trial end date out, resets overage state, and reactivates the license if it was hard-blocked.',
                        )
                      ) {
                        return
                      }
                      void run('extend', async () => {
                        const res = await api.extendTrial(id, { days })
                        toast.success(`Trial extended to ${formatDate(res.trialEndsAt)}.`)
                      })
                    }}
                  >
                    <div className="grid gap-1.5">
                      <Label htmlFor="trial-days">Add days</Label>
                      <Input
                        id="trial-days"
                        type="number"
                        min={1}
                        value={trialDays}
                        onChange={(event) => setTrialDays(event.target.value)}
                        className="w-28"
                      />
                    </div>
                    <Button type="submit" disabled={busy !== null}>
                      {busy === 'extend' ? 'Extending…' : 'Extend date'}
                    </Button>
                  </form>

                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const pages = Number(trialPages)
                      if (!Number.isFinite(pages) || pages <= 0) {
                        toast.error('Enter a positive number of pages.')
                        return
                      }
                      const recurring = pagesMode === 'recurring'
                      if (
                        !window.confirm(
                          `Add ${formatNumber(pages)} ${recurring ? 'recurring' : 'one-time'} pages to ${data.organizationName}?\n\n` +
                            (recurring
                              ? `The per-period limit will rise from ${formatNumber(data.limit)} to ${formatNumber(data.limit + pages)} pages, every period.`
                              : `${formatNumber(pages)} extra pages will be added for the current period only (effective limit ${formatNumber(data.limit + pages)}); they expire at the next reset.`) +
                            '\n\nThis resets overage state and reactivates the license if it was hard-blocked.',
                        )
                      ) {
                        return
                      }
                      void run('pages', async () => {
                        const res = await api.addPages(id, pages, recurring)
                        toast.success(
                          `Added ${formatNumber(pages)} ${recurring ? 'recurring' : 'one-time'} pages — effective limit ${formatNumber(res.limitUnits)}.`,
                        )
                      })
                    }}
                  >
                    <div className="grid gap-1.5">
                      <Label htmlFor="trial-pages">Add pages</Label>
                      <Input
                        id="trial-pages"
                        type="number"
                        min={1}
                        value={trialPages}
                        onChange={(event) => setTrialPages(event.target.value)}
                        className="w-28"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="pages-mode">Type</Label>
                      <select
                        id="pages-mode"
                        value={pagesMode}
                        onChange={(event) => setPagesMode(event.target.value as 'one_time' | 'recurring')}
                        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                      >
                        <option value="one_time">One-time (this period)</option>
                        <option value="recurring">Recurring (every period)</option>
                      </select>
                    </div>
                    <Button type="submit" variant="outline" disabled={busy !== null}>
                      {busy === 'pages' ? 'Adding…' : 'Add pages'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>Key operations</CardTitle>
                  <CardDescription>Rotate issues a new key; revoke disables the license.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        void run('rotate', async () => {
                          const res = await api.rotateKey(id)
                          setRotatedKey(res.key)
                          toast.success('Key rotated. Copy it now — it is shown once.')
                        })
                      }
                    >
                      {busy === 'rotate' ? 'Rotating…' : 'Rotate key'}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm('Revoke this license? Clients will fail to authorize.')) {
                          return
                        }
                        void run('revoke', async () => {
                          await api.revoke(id)
                          toast.success('License revoked.')
                        })
                      }}
                    >
                      {busy === 'revoke' ? 'Revoking…' : 'Revoke'}
                    </Button>
                  </div>
                  {rotatedKey ? (
                    <div className="rounded-md border border-border bg-muted-surface p-3">
                      <p className="text-xs text-muted-foreground">New key (shown once):</p>
                      <code className="text-sm break-all">{rotatedKey}</code>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Telemetry</CardTitle>
                <CardDescription>Recent authorize / usage events for this license</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Pages</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead className="text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.telemetry.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="font-mono text-xs">{event.endpoint}</TableCell>
                        <TableCell>
                          <TelemetryBadge status={event.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(event.pages)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {event.jobDescription ?? event.jobId ?? '—'}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatDateTime(event.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.telemetry.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No telemetry for this license yet.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        ) : null}
      </PageContainer>
    </>
  )
}

function oneYearOut(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

function ChangePlanCard({ data, onChanged }: { data: LicenseUsage; onChanged: () => void }) {
  const customIndex = ANNUAL_TIERS.findIndex((t) => t.limit === null)
  const matchedTier = ANNUAL_TIERS.findIndex((t) => t.limit === data.baseLimit)
  const [tierIndex, setTierIndex] = useState(String(matchedTier === -1 ? customIndex : matchedTier))
  const [customLimit, setCustomLimit] = useState(String(data.baseLimit))
  const [planWindow, setPlanWindow] = useState<UsageWindow>(data.window)
  const isTrial = data.trialEndsAt !== null
  const [busy, setBusy] = useState(false)

  const tier = ANNUAL_TIERS[Number(tierIndex)] ?? ANNUAL_TIERS[0]!
  const isCustomTier = tier.limit === null
  const resolvedLimit = isCustomTier ? Number(customLimit) : tier.limit!

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change plan</CardTitle>
        <CardDescription>
          {isTrial
            ? 'Setting a plan on a trial converts it to paid — ends the trial, removes the watermark, reactivates, and flushes usage to 0.'
            : 'Set the annual page volume and billing window. Usage is kept (not flushed) — an upgrade can lift a hard-blocked license back into service; a downgrade below current usage stays blocked.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!Number.isFinite(resolvedLimit) || resolvedLimit <= 0) {
              toast.error('Enter a positive page limit for the custom tier.')
              return
            }
            const expires = planWindow === 'year' ? new Date(oneYearOut()).toISOString() : null
            const willConvert = isTrial
            const downgradeBelowUsage = !willConvert && resolvedLimit < data.used
            const ok = window.confirm(
              `Change ${data.organizationName} to ${formatLimit(resolvedLimit)} pages / ${planWindow === 'year' ? 'annual' : 'lifetime'}?\n\n` +
                (willConvert
                  ? `• Converts the trial to paid: removes the watermark, ends the trial, reactivates, and flushes usage (currently ${formatNumber(data.used)}) to 0.\n`
                  : '') +
                (downgradeBelowUsage
                  ? `⚠ New limit (${formatLimit(resolvedLimit)}) is below current usage (${formatNumber(data.used)}) — the license will stay hard-blocked until usage resets.\n\n`
                  : '') +
                `Renewal date: ${expires ? formatDate(expires) : 'none (perpetual)'}.`,
            )
            if (!ok) return
            setBusy(true)
            void (async () => {
              try {
                const res = await api.changePlan(data.id, {
                  limit: resolvedLimit,
                  window: planWindow,
                  expiresAt: expires,
                  convertToPaid: willConvert,
                })
                toast.success(
                  `${willConvert ? 'Converted to paid' : 'Plan updated'} — ${formatLimit(res.limitUnits)} pages / ${res.window === 'year' ? 'annual' : 'lifetime'}.`,
                )
                onChanged()
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : 'Could not change plan.')
              } finally {
                setBusy(false)
              }
            })()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="plan-tier">Annual pages</Label>
            <Select value={tierIndex} onValueChange={(v) => setTierIndex(v ?? '0')}>
              <SelectTrigger id="plan-tier" className="w-48">
                <SelectValue>{tier.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ANNUAL_TIERS.map((t, i) => (
                  <SelectItem key={t.label} value={String(i)}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isCustomTier ? (
            <div className="grid gap-1.5">
              <Label htmlFor="plan-custom">Custom limit</Label>
              <Input
                id="plan-custom"
                type="number"
                min={1}
                value={customLimit}
                onChange={(event) => setCustomLimit(event.target.value)}
                className="w-32"
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="plan-window">Window</Label>
            <Select value={planWindow} onValueChange={(v) => setPlanWindow((v as UsageWindow) ?? 'year')}>
              <SelectTrigger id="plan-window" className="w-32">
                <SelectValue>{planWindow === 'year' ? 'Annual' : 'Lifetime'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="year">Annual</SelectItem>
                <SelectItem value="lifetime">Lifetime</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {planWindow === 'year' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="plan-expires">Plan expiry date</Label>
              <Input id="plan-expires" type="date" value={oneYearOut()} disabled className="w-40" />
            </div>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : isTrial ? 'Convert to paid' : 'Change plan'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
