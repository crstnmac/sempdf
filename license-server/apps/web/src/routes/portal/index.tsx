import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  CheckCircle2Icon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  RocketIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'

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
import { Input } from '#/components/ui/input.tsx'
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
  activityLabel,
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

  // The license that drives the headline: the most over-extended / soonest to
  // matter, falling back to the newest.
  const primary = useMemo(() => {
    const licenses = data?.licenses ?? []
    return [...licenses].sort((a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status])[0] ?? null
  }, [data])

  async function createKey(licenseId: string, name: string) {
    setBusyId(licenseId)
    try {
      const { key } = await portalApi.createKey(licenseId, name)
      setIssued({ licenseId, key })
      toast.success('API key created. Copy it now — it is shown once.')
      refetch()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create key.')
    } finally {
      setBusyId(null)
    }
  }

  async function revokeKey(keyId: string, name: string) {
    if (
      !window.confirm(
        `Revoke the key "${name}"? Any app using it will stop working immediately. Other keys keep working.`,
      )
    ) {
      return
    }
    try {
      await portalApi.revokeKey(keyId)
      toast.success('Key revoked.')
      refetch()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not revoke key.')
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
            <NoLicense />
          ) : (
            <>
              <StatusBanner licenses={data.licenses} />

              {primary ? <UsageSummary summary={data.summary} primary={primary} /> : null}

              <LicensesSection
                licenses={data.licenses}
                issued={issued}
                busyId={busyId}
                onCreate={createKey}
                onRevoke={revokeKey}
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
              ? 'Output watermarked “SemPDF - For Trial Use Only”'
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

function LicensesSection({
  licenses,
  issued,
  busyId,
  onCreate,
  onRevoke,
}: {
  licenses: PortalLicense[]
  issued: { licenseId: string; key: string } | null
  busyId: string | null
  onCreate: (licenseId: string, name: string) => void
  onRevoke: (keyId: string, name: string) => void
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold text-foreground">Licenses & API keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          API keys authenticate the sempdf library. Create one per environment (production,
          staging, CI) — they all share this plan's page quota. Set{' '}
          <code className="rounded bg-muted-surface px-1 py-0.5 text-xs">SEMPDF_LICENSE_KEY</code> in
          your environment — the server URL is baked in, so there's nothing else to configure.
        </p>
      </div>
      {licenses.map((lic) => (
        <LicenseCard
          key={lic.id}
          lic={lic}
          issuedKey={issued?.licenseId === lic.id ? issued.key : null}
          busy={busyId === lic.id}
          onCreate={onCreate}
          onRevoke={onRevoke}
        />
      ))}
    </section>
  )
}

/** Plain-language renewal / trial line for a license. */
function renewalLine(lic: PortalLicense): string {
  if (lic.status === 'trial') {
    return lic.trialEndsAt
      ? `Trial ends ${formatDate(lic.trialEndsAt)} · ${relativeDays(lic.trialEndsAt)}`
      : 'Trial'
  }
  if (lic.resetAt) return `Page count resets ${formatDate(lic.resetAt)} · ${relativeDays(lic.resetAt)}`
  return 'Lifetime license'
}

function LicenseCard({
  lic,
  issuedKey,
  busy,
  onCreate,
  onRevoke,
}: {
  lic: PortalLicense
  issuedKey: string | null
  busy: boolean
  onCreate: (licenseId: string, name: string) => void
  onRevoke: (keyId: string, name: string) => void
}) {
  const remaining = lic.limitUnits - lic.usedUnits
  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{lic.organizationName}</CardTitle>
          <StatusBadge status={lic.status} />
          <WatermarkBadge status={lic.status} />
        </div>
        <CardDescription>{renewalLine(lic)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <UsageMeter used={lic.usedUnits} limit={lic.limitUnits} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {remaining < 0
              ? `${formatNumber(-remaining)} pages over the limit`
              : `${formatNumber(remaining)} of ${formatNumber(lic.limitUnits)} pages remaining`}
          </p>
        </div>

        <KeysManager lic={lic} issuedKey={issuedKey} busy={busy} onCreate={onCreate} onRevoke={onRevoke} />

        <QuickStart />
      </CardContent>
    </Card>
  )
}

/** Lists a license's API keys and lets the customer create or revoke them. */
function KeysManager({
  lic,
  issuedKey,
  busy,
  onCreate,
  onRevoke,
}: {
  lic: PortalLicense
  issuedKey: string | null
  busy: boolean
  onCreate: (licenseId: string, name: string) => void
  onRevoke: (keyId: string, name: string) => void
}) {
  const [name, setName] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onCreate(lic.id, name.trim() || 'New key')
    setName('')
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted-surface/40 p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          API keys
        </p>
        <span className="text-xs text-muted-foreground">
          {lic.keys.length} active · all share this plan's quota
        </span>
      </div>

      {issuedKey ? <KeyReveal apiKey={issuedKey} /> : null}

      {lic.keys.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {lic.keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{k.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{k.keyPrefix}••••••••</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
                  {k.lastUsedAt ? `Used ${relativeDays(k.lastUsedAt)}` : 'Never used'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onRevoke(k.id, k.name)}
                >
                  <Trash2Icon />
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No active keys. Create one to start generating PDFs.
        </p>
      )}

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this key (e.g. production)"
          maxLength={60}
          disabled={!lic.active || busy}
          className="sm:max-w-xs"
        />
        <Button type="submit" size="sm" disabled={!lic.active || busy}>
          <PlusIcon />
          {busy ? 'Creating…' : 'Create key'}
        </Button>
      </form>
    </div>
  )
}

/** One-time reveal shown immediately after a key is (re)generated. */
function KeyReveal({ apiKey }: { apiKey: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
        <CheckCircle2Icon className="size-4" />
        New API key — copy it now
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm break-all">
          {apiKey}
        </code>
        <Button variant="outline" size="sm" onClick={() => copy(apiKey)}>
          <CopyIcon />
          Copy
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-warning">
        <TriangleAlertIcon className="size-3.5" />
        This is the only time the key is shown. It can't be retrieved later — store it securely.
      </p>
    </div>
  )
}

/** Collapsible copy-paste integration guide (no secret in the snippet). */
function QuickStart() {
  const snippet = `# .env
SEMPDF_LICENSE_KEY=<your-key>

# app.ts
import { createDocument } from '@barrierbreak/sempdf-pdf'

const doc = createDocument({ title: 'Invoice', language: 'en-US' })
doc.addPage({ size: 'A4' }).text('Hello', { x: 24, y: 700 })
const bytes = doc.toUint8Array() // license is verified automatically`

  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-medium">
        Quick start — use the key with the library
        <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-border p-4">
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => copy(snippet)}>
            <CopyIcon />
            Copy
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-md border border-border bg-card p-3 text-xs">
          <code>{snippet}</code>
        </pre>
      </div>
    </details>
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
                <TableCell className="font-medium">{activityLabel(event.status as never)}</TableCell>
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
function NoLicense() {
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RocketIcon className="size-5 text-primary" />
          No license yet
        </CardTitle>
        <CardDescription>
          Your account doesn’t have a license. Contact your account manager to set up a trial or plan.
        </CardDescription>
      </CardHeader>
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
  const trial = licenses.find((lic) => lic.status === 'trial')
  if (trial) {
    return (
      <Banner tone="info">
        Trial active{trial.trialEndsAt ? ` — ends ${relativeDays(trial.trialEndsAt)}` : ''}. All
        output PDFs are watermarked <strong>“SemPDF - For Trial Use Only”</strong> until you upgrade.
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
