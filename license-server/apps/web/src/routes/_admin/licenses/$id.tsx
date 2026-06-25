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
  ApiError,
  api,
  formatDate,
  formatDateTime,
  formatNumber,
  relativeDays,
} from '#/lib/api.ts'

export const Route = createFileRoute('/_admin/licenses/$id')({ component: LicenseDetailPage })

function LicenseDetailPage() {
  const { id } = Route.useParams()
  const { data, loading, error, refetch } = useAsync(() => api.licenseUsage(id), [id])

  const [trialDays, setTrialDays] = useState('15')
  const [busy, setBusy] = useState<null | 'extend' | 'rotate' | 'revoke'>(null)
  const [rotatedKey, setRotatedKey] = useState<string | null>(null)

  async function run(action: 'extend' | 'rotate' | 'revoke', fn: () => Promise<unknown>) {
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

  // Hard-block date = first overage + grace period (server enforces the same).
  const hardBlockAt = data?.firstOverageAt
    ? new Date(
        new Date(data.firstOverageAt).getTime() + data.gracePeriodDays * 24 * 60 * 60 * 1000,
      ).toISOString()
    : null

  return (
    <>
      <SiteHeader
        title="License detail"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/licenses">
              <ArrowLeftIcon />
              Back
            </Link>
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
                  <Stat label="Remaining" value={formatNumber(data.remaining)} />
                  <Stat label="Metric" value={data.metric} />
                  <Stat
                    label="Trial ends"
                    value={formatDate(data.trialEndsAt)}
                    hint={data.trialEndsAt ? relativeDays(data.trialEndsAt) : undefined}
                  />
                  <Stat
                    label="First overage"
                    value={formatDate(data.firstOverageAt)}
                    hint={data.firstOverageAt ? relativeDays(data.firstOverageAt) : undefined}
                  />
                  <Stat label="Grace period" value={`${data.gracePeriodDays} days`} />
                  <Stat
                    label="Hard block"
                    value={formatDate(hardBlockAt)}
                    hint={hardBlockAt ? relativeDays(hardBlockAt) : undefined}
                  />
                </div>
                {data.status === 'grace_period' ? (
                  <p className="rounded-md bg-warning-surface px-3 py-2 text-sm text-warning">
                    In grace period — future runs are watermarked “Over Limit”. Hard block{' '}
                    {hardBlockAt ? relativeDays(hardBlockAt) : 'after grace expires'}.
                  </p>
                ) : null}
                {data.status === 'hard_blocked' ? (
                  <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">
                    Hard blocked — all new runs are rejected until payment/renewal.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Extend trial</CardTitle>
                  <CardDescription>
                    Push the trial end date out and reset overage state.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="flex items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const days = Number(trialDays)
                      if (!Number.isFinite(days) || days <= 0) {
                        toast.error('Enter a positive number of days.')
                        return
                      }
                      void run('extend', async () => {
                        const res = await api.extendTrial(id, { days })
                        toast.success(`Trial extended to ${formatDate(res.trialEndsAt)}.`)
                      })
                    }}
                  >
                    <div className="grid gap-1.5">
                      <Label htmlFor="trial-days">Days</Label>
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
                      {busy === 'extend' ? 'Extending…' : 'Extend trial'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
