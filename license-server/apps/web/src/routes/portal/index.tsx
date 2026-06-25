import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CopyIcon, KeyRoundIcon, RocketIcon } from 'lucide-react'

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
  ApiError,
  type PortalLicense,
  type TenantStatus,
  endpointLabel,
  formatDate,
  formatDateTime,
  formatNumber,
  portalApi,
  relativeDays,
  statusLabel,
  usagePercent,
} from '#/lib/api.ts'

export const Route = createFileRoute('/portal/')({ component: PortalOverviewPage })

const STATUS_SEVERITY: Record<TenantStatus, number> = {
  hard_blocked: 3,
  grace_period: 2,
  trial: 1,
  none: 0,
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard.')
  } catch {
    toast.error('Copy failed — select and copy manually.')
  }
}

function PortalOverviewPage() {
  const { data, loading, error, refetch } = useAsync(() => portalApi.overview())
  const [issued, setIssued] = useState<{ licenseId: string; key: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [startingTrial, setStartingTrial] = useState(false)

  // The license that drives the headline: the most over-extended / soonest to
  // matter, falling back to the newest.
  const primary = useMemo(() => {
    const licenses = data?.licenses ?? []
    return [...licenses].sort((a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status])[0] ?? null
  }, [data])

  async function startTrial() {
    setStartingTrial(true)
    try {
      const res = await portalApi.startTrial()
      if (res.key) setIssued({ licenseId: res.id, key: res.key })
      toast.success(res.created ? 'Trial started.' : 'You already have a license.')
      refetch()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not start trial.')
    } finally {
      setStartingTrial(false)
    }
  }

  async function generateKey(licenseId: string) {
    if (
      !window.confirm(
        'Generate a new API key? This invalidates the current key — any app using it will stop working until updated.',
      )
    ) {
      return
    }
    setBusyId(licenseId)
    try {
      const { key } = await portalApi.generateKey(licenseId)
      setIssued({ licenseId, key })
      toast.success('API key generated. Copy it now — it is shown once.')
      refetch()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not generate key.')
    } finally {
      setBusyId(null)
    }
  }

  const hasLicenses = (data?.licenses.length ?? 0) > 0

  return (
    <>
      <SiteHeader
        title="Overview"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice title="Loading your organization" message="Fetching your licenses and usage." />
        ) : error ? (
          <StateNotice title="Unavailable" message={error} tone="warning" onRetry={refetch} />
        ) : data ? (
          !hasLicenses ? (
            <GetStarted
              canStart={data.organizations.length > 0}
              starting={startingTrial}
              onStart={startTrial}
            />
          ) : (
            <>
              <StatusBanner licenses={data.licenses} />

              {primary ? <UsageSummary summary={data.summary} primary={primary} /> : null}

              {issued ? <KeyReveal apiKey={issued.key} /> : null}

              <LicensesCard
                licenses={data.licenses}
                busyId={busyId}
                onGenerate={generateKey}
              />

              <ActivityCard telemetry={data.telemetry} />

              {data.organizations.length > 1 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Organizations</CardTitle>
                    <CardDescription>Accounts you own or belong to</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {data.organizations.map((org) => (
                      <span
                        key={org.id}
                        className="rounded-md border border-border bg-muted-surface px-3 py-1.5 text-sm"
                      >
                        {org.name}
                        <span className="ml-2 text-xs text-muted-foreground">{org.role}</span>
                      </span>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </>
          )
        ) : null}
      </PageContainer>
    </>
  )
}

/** The meaningful headline: usage vs limit, remaining/overage, and what's next. */
function UsageSummary({
  summary,
  primary,
}: {
  summary: { pagesUsed: number; pageLimit: number; activeLicenses: number }
  primary: PortalLicense
}) {
  const used = summary.pagesUsed
  const limit = summary.pageLimit
  const remaining = limit - used
  const over = remaining < 0
  const pct = usagePercent(used, limit)

  const nextLabel = primary.status === 'trial' && primary.trialEndsAt ? 'Trial ends' : 'Resets'
  const nextValue =
    primary.status === 'trial'
      ? primary.trialEndsAt
        ? relativeDays(primary.trialEndsAt)
        : '—'
      : primary.resetAt
        ? relativeDays(primary.resetAt)
        : 'Never (lifetime)'

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardDescription>Page usage this period</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">
            {formatNumber(used)}
            <span className="text-base font-normal text-muted-foreground">
              {' '}
              / {limit > 0 ? formatNumber(limit) : '∞'} pages
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UsageMeter used={used} limit={limit} showNumbers={false} />
          <p className="mt-2 text-sm text-muted-foreground">
            {over ? (
              <span className="font-medium text-destructive">
                {formatNumber(-remaining)} pages over the limit
              </span>
            ) : (
              <>
                {formatNumber(remaining)} pages remaining ({pct}% used)
              </>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4">
        <StatCard
          label="Plan status"
          value={statusLabel(primary.status)}
          hint={
            primary.status === 'trial'
              ? 'Output watermarked “Trial Mode”'
              : primary.status === 'grace_period'
                ? 'Future runs watermarked'
                : primary.status === 'hard_blocked'
                  ? 'New runs rejected'
                  : 'All clear'
          }
        />
        <StatCard label={nextLabel} value={nextValue} hint={formatDate(primary.status === 'trial' ? primary.trialEndsAt : primary.resetAt)} />
      </div>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="@container/card">
      <CardHeader className="gap-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-lg font-semibold">{value}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
    </Card>
  )
}

function LicensesCard({
  licenses,
  busyId,
  onGenerate,
}: {
  licenses: PortalLicense[]
  busyId: string | null
  onGenerate: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Licenses & API keys</CardTitle>
        <CardDescription>
          Generate a key, then set <code>A11YDOCS_LICENSE_KEY</code> in your environment. The server
          URL is baked into the library — no other configuration needed. Keys are shown once and
          stored hashed; regenerate if you lose one.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-56">Usage</TableHead>
              <TableHead>Renews / ends</TableHead>
              <TableHead className="text-right">API key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {licenses.map((lic) => (
              <TableRow key={lic.id}>
                <TableCell className="font-medium">
                  {lic.organizationName}
                  <div className="font-mono text-xs text-muted-foreground">{lic.keyPrefix}…</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={lic.status} />
                    <WatermarkBadge status={lic.status} />
                  </div>
                </TableCell>
                <TableCell>
                  <UsageMeter used={lic.usedUnits} limit={lic.limitUnits} />
                </TableCell>
                <TableCell className="text-sm">
                  {lic.status === 'trial' ? (
                    <>
                      <span>Trial ends {formatDate(lic.trialEndsAt)}</span>
                      {lic.trialEndsAt ? (
                        <div className="text-xs text-muted-foreground">{relativeDays(lic.trialEndsAt)}</div>
                      ) : null}
                    </>
                  ) : lic.resetAt ? (
                    <>
                      <span>Resets {formatDate(lic.resetAt)}</span>
                      <div className="text-xs text-muted-foreground">{relativeDays(lic.resetAt)}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Lifetime</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!lic.active || busyId === lic.id}
                    onClick={() => onGenerate(lic.id)}
                  >
                    <KeyRoundIcon />
                    {busyId === lic.id ? 'Generating…' : 'Generate key'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function ActivityCard({ telemetry }: { telemetry: { id: number; organizationName: string; endpoint: string; status: PortalLicense['status'] | string; pages: number; createdAt: string }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>The latest generation events for your organizations</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Result</TableHead>
              <TableHead className="text-right">Pages</TableHead>
              <TableHead className="text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {telemetry.slice(0, 8).map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">{endpointLabel(event.endpoint)}</TableCell>
                <TableCell>
                  <TelemetryBadge status={event.status as never} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(event.pages)}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {telemetry.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No activity yet — generate your first PDF to see events here.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/** Onboarding shown when the account has no license yet. */
function GetStarted({
  canStart,
  starting,
  onStart,
}: {
  canStart: boolean
  starting: boolean
  onStart: () => void
}) {
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RocketIcon className="size-5 text-primary" />
          Start your free trial
        </CardTitle>
        <CardDescription>
          Get a license key to start generating accessible PDFs. Trial output is watermarked “Trial
          Mode”; upgrade any time to remove it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <Button size="sm" disabled={starting || !canStart} onClick={onStart}>
          {starting ? 'Starting…' : 'Start free trial'}
        </Button>
        {!canStart ? (
          <p className="text-sm text-muted-foreground">
            You are not an owner or admin of any organization yet.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function KeyReveal({ apiKey }: { apiKey: string }) {
  const snippet = `# Set in your environment (server URL is baked into the library):
#   A11YDOCS_LICENSE_KEY=${apiKey}

import { createDocument } from '@barrierbreak/a11ydocs-pdf'

const doc = createDocument({ title: 'Invoice' })
doc.addPage({ size: 'A4' }).text('Hello', { x: 24, y: 700 })
doc.toUint8Array()`

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle>Your new API key</CardTitle>
        <CardDescription>
          Set <code>A11YDOCS_LICENSE_KEY</code> in your environment and import the library — checkout
          and flush are automatic. Copy it now — it is shown only once and cannot be retrieved later.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm break-all">
            {apiKey}
          </code>
          <Button variant="outline" size="sm" onClick={() => copy(apiKey)}>
            <CopyIcon />
            Copy
          </Button>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-medium">Use it with the library</p>
            <Button variant="ghost" size="sm" onClick={() => copy(snippet)}>
              <CopyIcon />
              Copy snippet
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border border-border bg-card p-3 text-xs">
            <code>{snippet}</code>
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBanner({ licenses }: { licenses: PortalLicense[] }) {
  if (licenses.some((lic) => lic.status === 'hard_blocked')) {
    return (
      <Banner tone="danger">
        One or more licenses are <strong>hard blocked</strong> — new generation runs are rejected.
        Renew or contact your account manager to restore service.
      </Banner>
    )
  }
  if (licenses.some((lic) => lic.status === 'grace_period')) {
    return (
      <Banner tone="warning">
        You are over your page limit. Current runs finish normally, but{' '}
        <strong>future runs are watermarked “Over Limit”</strong> during the grace period. Add
        credits before the grace period ends to avoid a hard block.
      </Banner>
    )
  }
  const trial = licenses.find((lic) => lic.status === 'trial')
  if (trial) {
    return (
      <Banner tone="info">
        Trial active{trial.trialEndsAt ? ` — ends ${relativeDays(trial.trialEndsAt)}` : ''}. All
        output PDFs are watermarked <strong>“Trial Mode”</strong> until you upgrade.
      </Banner>
    )
  }
  return null
}

function Banner({ tone, children }: { tone: 'info' | 'warning' | 'danger'; children: React.ReactNode }) {
  const styles = {
    info: 'bg-accent text-accent-foreground',
    warning: 'bg-warning-surface text-warning',
    danger: 'bg-danger-surface text-danger',
  }[tone]
  return <div className={`rounded-lg px-4 py-3 text-sm ${styles}`}>{children}</div>
}
