import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeftIcon } from 'lucide-react'

import { SiteHeader } from '#/components/site-header.tsx'
import {
  PageContainer,
  Pager,
  StateNotice,
  StatusBadge,
  TelemetryBadge,
  UsageMeter,
  WatermarkBadge,
} from '#/components/page-shell.tsx'
import { useConfirm } from '#/components/confirm.tsx'
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
  type TelemetryRow,
  type UsageWindow,
  activityLabel,
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
  const confirm = useConfirm()

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
                  {data.trialEndsAt ? (
                    <Stat
                      label="Trial ends"
                      value={formatDate(data.trialEndsAt)}
                      hint={relativeDays(data.trialEndsAt)}
                    />
                  ) : data.window === 'lifetime' ? (
                    <Stat label="Term" value="Lifetime" hint="never expires" />
                  ) : (
                    <Stat
                      label="Renews"
                      value={formatDate(data.expiresAt)}
                      hint={data.expiresAt ? relativeDays(data.expiresAt) : 'no renewal date'}
                    />
                  )}
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
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const days = Number(trialDays)
                      if (!Number.isFinite(days) || days <= 0) {
                        toast.error('Enter a positive number of days.')
                        return
                      }
                      const ok = await confirm({
                        title: `Extend trial by ${days} day${days === 1 ? '' : 's'}?`,
                        description: `Moves ${data.organizationName}'s trial end date out, resets overage state, and reactivates the license if it was hard-blocked.`,
                        confirmLabel: 'Extend trial',
                      })
                      if (!ok) return
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
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const pages = Number(trialPages)
                      if (!Number.isFinite(pages) || pages <= 0) {
                        toast.error('Enter a positive number of pages.')
                        return
                      }
                      const recurring = pagesMode === 'recurring'
                      const ok = await confirm({
                        title: `Add ${formatNumber(pages)} ${recurring ? 'recurring' : 'one-time'} pages?`,
                        description: (recurring
                          ? `${data.organizationName}'s per-period limit rises from ${formatNumber(data.limit)} to ${formatNumber(data.limit + pages)} pages, every period.`
                          : `${formatNumber(pages)} extra pages for the current period only (effective limit ${formatNumber(data.limit + pages)}); they expire at the next reset.`) +
                          ' Resets overage state and reactivates the license if it was hard-blocked.',
                        confirmLabel: 'Add pages',
                      })
                      if (!ok) return
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
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Revoke this license?',
                          description: `Every API key on ${data.organizationName} stops working immediately — clients will fail to authorize. This cannot be undone from here.`,
                          confirmLabel: 'Revoke license',
                          destructive: true,
                        })
                        if (!ok) return
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

            <LicenseTelemetryCard id={id} />
          </>
        ) : null}
      </PageContainer>
    </>
  )
}

const TELEMETRY_PAGE_SIZE = 25

/** Server-paginated generation events for one license. */
function LicenseTelemetryCard({ id }: { id: string }) {
  const [page, setPage] = useState(1)
  const { data, loading } = useAsync(
    () => api.licenseTelemetry(id, { page, pageSize: TELEMETRY_PAGE_SIZE }),
    [id, page],
  )
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / TELEMETRY_PAGE_SIZE))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telemetry</CardTitle>
        <CardDescription>
          {total > 0
            ? `${formatNumber(total)} generation events with the client + runtime each run reported`
            : 'Generation events with the client + runtime each run reported'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Pages</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Client / runtime</TableHead>
                <TableHead>Document</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{activityLabel(event.status)}</span>
                      <TelemetryBadge status={event.status} />
                    </div>
                    {event.errorCode ? (
                      <div className="mt-0.5 font-mono text-xs text-destructive">{event.errorCode}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(event.pages)}</TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                    {event.jobDescription ?? event.jobId ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{clientLine(event)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{documentLine(event)}</TableCell>
                  <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No telemetry for this license yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        {lastPage > 1 ? (
          <div className="px-4 pb-4">
            <Pager page={page} lastPage={lastPage} loading={loading} onPage={setPage} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** SDK + runtime a generation reported (lib version · platform · node). */
function clientLine(event: TelemetryRow): React.ReactNode {
  const parts = [
    event.libVersion ? `lib ${event.libVersion}` : null,
    event.platform,
    event.nodeVersion ? `node ${event.nodeVersion}` : null,
  ].filter(Boolean)
  return parts.length ? <span className="font-mono">{parts.join(' · ')}</span> : '—'
}

/** Document attributes a generation reported (conformance · language · tagged). */
function documentLine(event: TelemetryRow): React.ReactNode {
  const parts = [
    event.conformance,
    event.language,
    event.tagged === null ? null : event.tagged ? 'tagged' : 'untagged',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function yearAfter(date: string): string {
  const d = date ? new Date(date) : new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

function ChangePlanCard({ data, onChanged }: { data: LicenseUsage; onChanged: () => void }) {
  const confirm = useConfirm()
  const customIndex = ANNUAL_TIERS.findIndex((t) => t.limit === null)
  const matchedTier = ANNUAL_TIERS.findIndex((t) => t.limit === data.baseLimit)
  const [tierIndex, setTierIndex] = useState(String(matchedTier === -1 ? customIndex : matchedTier))
  const [customLimit, setCustomLimit] = useState(String(data.baseLimit))
  const [planWindow, setPlanWindow] = useState<UsageWindow>(data.window)
  // Term: "auto" = starts today, expires one year out; "custom" = operator dates.
  const [termMode, setTermMode] = useState<'auto' | 'custom'>('auto')
  const [startDate, setStartDate] = useState(data.windowStartedAt ? data.windowStartedAt.slice(0, 10) : todayStr())
  const [expiryDate, setExpiryDate] = useState(data.expiresAt ? data.expiresAt.slice(0, 10) : yearAfter(todayStr()))
  const isTrial = data.trialEndsAt !== null
  const [busy, setBusy] = useState(false)

  const tier = ANNUAL_TIERS[Number(tierIndex)] ?? ANNUAL_TIERS[0]!
  const isCustomTier = tier.limit === null
  const resolvedLimit = isCustomTier ? Number(customLimit) : tier.limit!
  const isCustomTerm = planWindow === 'year' && termMode === 'custom'

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
          onSubmit={async (event) => {
            event.preventDefault()
            if (!Number.isFinite(resolvedLimit) || resolvedLimit <= 0) {
              toast.error('Enter a positive page limit for the custom tier.')
              return
            }
            // Lifetime: no dates. Annual auto: starts today, expires +1yr.
            // Annual custom: operator's start + expiry.
            let starts: string | null = null
            let expires: string | null = null
            if (planWindow === 'year') {
              if (termMode === 'custom') {
                if (!startDate || !expiryDate) {
                  toast.error('Set both a start and an expiry date.')
                  return
                }
                if (new Date(expiryDate).getTime() <= new Date(startDate).getTime()) {
                  toast.error('Expiry date must be after the start date.')
                  return
                }
                starts = new Date(startDate).toISOString()
                expires = new Date(expiryDate).toISOString()
              } else {
                starts = new Date(todayStr()).toISOString()
                expires = new Date(yearAfter(todayStr())).toISOString()
              }
            }
            const willConvert = isTrial
            const downgradeBelowUsage = !willConvert && resolvedLimit < data.used
            const termLine =
              planWindow === 'year'
                ? `Term: ${formatDate(starts)} → ${formatDate(expires)}.`
                : 'Term: lifetime (perpetual).'
            const ok = await confirm({
              title: willConvert
                ? `Convert ${data.organizationName} to paid?`
                : `Change ${data.organizationName}'s plan?`,
              description: (
                <span className="flex flex-col gap-1.5 text-left">
                  <span>
                    {formatLimit(resolvedLimit)} pages / {planWindow === 'year' ? 'annual' : 'lifetime'}. {termLine}
                  </span>
                  {willConvert ? (
                    <span>
                      Converts the trial to paid: removes the watermark, ends the trial, reactivates,
                      and flushes usage (currently {formatNumber(data.used)}) to 0.
                    </span>
                  ) : null}
                  {downgradeBelowUsage ? (
                    <span className="font-medium text-destructive">
                      New limit ({formatLimit(resolvedLimit)}) is below current usage (
                      {formatNumber(data.used)}) — the license stays hard-blocked until usage resets.
                    </span>
                  ) : null}
                </span>
              ),
              confirmLabel: willConvert ? 'Convert to paid' : 'Change plan',
              destructive: downgradeBelowUsage,
            })
            if (!ok) return
            setBusy(true)
            void (async () => {
              try {
                const res = await api.changePlan(data.id, {
                  limit: resolvedLimit,
                  window: planWindow,
                  startsAt: starts,
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
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-term">Term</Label>
                <Select value={termMode} onValueChange={(v) => setTermMode((v as 'auto' | 'custom') ?? 'auto')}>
                  <SelectTrigger id="plan-term" className="w-44">
                    <SelectValue>{termMode === 'auto' ? '1 year from today' : 'Custom dates'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">1 year from today</SelectItem>
                    <SelectItem value="custom">Custom dates</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isCustomTerm ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="plan-start">Start date</Label>
                    <Input
                      id="plan-start"
                      type="date"
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                      className="w-40"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="plan-expiry">Expiry date</Label>
                    <Input
                      id="plan-expiry"
                      type="date"
                      min={startDate}
                      value={expiryDate}
                      onChange={(event) => setExpiryDate(event.target.value)}
                      className="w-40"
                    />
                  </div>
                </>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="plan-expires">Plan expiry date</Label>
                  <Input id="plan-expires" type="date" value={yearAfter(todayStr())} disabled className="w-40" />
                </div>
              )}
            </>
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
