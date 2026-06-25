import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CopyIcon, KeyRoundIcon } from 'lucide-react'

import { SiteHeader } from '#/components/site-header.tsx'
import {
  PageContainer,
  StateNotice,
  StatusBadge,
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
  formatDate,
  formatNumber,
  portalApi,
  relativeDays,
} from '#/lib/api.ts'

export const Route = createFileRoute('/portal/')({ component: PortalOverviewPage })

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

  const serverUrl = typeof window !== 'undefined' ? window.location.origin : 'https://license.example.com'

  const [startingTrial, setStartingTrial] = useState(false)

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

  async function generateKey(licenseId: string, hasExisting: boolean) {
    if (
      hasExisting &&
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
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard label="Pages used" value={formatNumber(data.summary.pagesUsed)} />
              <MetricCard label="Page limit" value={formatNumber(data.summary.pageLimit)} />
              <MetricCard label="Active licenses" value={formatNumber(data.summary.activeLicenses)} />
            </div>

            <StatusBanner licenses={data.licenses} />

            {issued ? <KeyReveal apiKey={issued.key} serverUrl={serverUrl} /> : null}

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

            <Card>
              <CardHeader>
                <CardTitle>Licenses & API keys</CardTitle>
                <CardDescription>
                  Generate a key to use with the <code>@barrierbreak/a11ydocs-pdf</code> library.
                  Keys are shown once and stored hashed — regenerate if you lose one.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Watermark</TableHead>
                      <TableHead className="w-56">Usage</TableHead>
                      <TableHead>Trial ends</TableHead>
                      <TableHead className="text-right">API key</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.licenses.map((lic) => (
                      <TableRow key={lic.id}>
                        <TableCell className="font-medium">
                          {lic.organizationName}
                          <div className="font-mono text-xs text-muted-foreground">
                            {lic.keyPrefix}…
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={lic.status} />
                        </TableCell>
                        <TableCell>
                          <WatermarkBadge status={lic.status} />
                        </TableCell>
                        <TableCell>
                          <UsageMeter used={lic.usedUnits} limit={lic.limitUnits} />
                        </TableCell>
                        <TableCell>
                          {formatDate(lic.trialEndsAt)}
                          {lic.status === 'trial' && lic.trialEndsAt ? (
                            <div className="text-xs text-muted-foreground">
                              {relativeDays(lic.trialEndsAt)}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!lic.active || busyId === lic.id}
                            onClick={() => generateKey(lic.id, true)}
                          >
                            <KeyRoundIcon />
                            {busyId === lic.id ? 'Generating…' : 'Generate key'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.licenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center">
                          <p className="text-muted-foreground">No licenses yet.</p>
                          <Button
                            className="mt-3"
                            size="sm"
                            disabled={startingTrial || data.organizations.length === 0}
                            onClick={startTrial}
                          >
                            {startingTrial ? 'Starting…' : 'Start free trial'}
                          </Button>
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

function KeyReveal({ apiKey, serverUrl }: { apiKey: string; serverUrl: string }) {
  const snippet = `import { LicenseClient } from '@barrierbreak/a11ydocs-pdf/licensing'

const license = new LicenseClient({
  key: '${apiKey}',
  serverUrl: '${serverUrl}',
})

await license.checkout()        // reserve quota before generating
// ... doc.toUint8Array() / toBlob() now draw the lease down
await license.flush()           // report usage back for billing`

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle>Your new API key</CardTitle>
        <CardDescription>
          Copy it now — for security it is shown only once and cannot be retrieved later.
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
