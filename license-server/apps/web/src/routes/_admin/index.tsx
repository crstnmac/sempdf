import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { SectionCards } from '#/components/section-cards.tsx'
import { SiteHeader } from '#/components/site-header.tsx'
import {
  PageContainer,
  StateNotice,
  TelemetryBadge,
  UsageMeter,
} from '#/components/page-shell.tsx'
import { Badge } from '#/components/ui/badge.tsx'
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
  type DashboardTenant,
  api,
  daysUntil,
  activityLabel,
  formatDateTime,
  formatNumber,
  relativeDays,
} from '#/lib/api.ts'

export const Route = createFileRoute('/_admin/')({ component: DashboardPage })

type AttentionTone = 'danger' | 'warning' | 'info'
interface Attention {
  label: string
  detail: string
  tone: AttentionTone
  rank: number
}

/**
 * Why this tenant needs an operator's attention, or null if healthy. Ranked so
 * the most urgent (hard blocked) floats to the top of the triage list.
 */
function attentionFor(t: DashboardTenant): Attention | null {
  if (t.status === 'hard_blocked') {
    return { label: 'Hard blocked', detail: 'New runs rejected', tone: 'danger', rank: 4 }
  }
  if (t.remainingUnits < 0) {
    return { label: 'Over limit', detail: `${formatNumber(-t.remainingUnits)} pages over`, tone: 'warning', rank: 2 }
  }
  if (t.status === 'trial') {
    const d = daysUntil(t.trialEndsAt)
    if (d !== null && d <= 7) {
      return { label: 'Trial ending', detail: `Ends ${relativeDays(t.trialEndsAt)}`, tone: 'info', rank: 1 }
    }
  }
  return null
}

const TONE_BADGE: Record<AttentionTone, 'destructive' | 'outline' | 'secondary'> = {
  danger: 'destructive',
  warning: 'outline',
  info: 'secondary',
}

function DashboardPage() {
  const { data, loading, error, refetch } = useAsync(() => api.dashboard())

  const attention = useMemo(() => {
    if (!data) return []
    return data.tenants
      .map((t) => ({ tenant: t, info: attentionFor(t) }))
      .filter((row): row is { tenant: DashboardTenant; info: Attention } => row.info !== null)
      .sort((a, b) => b.info.rank - a.info.rank)
  }, [data])

  return (
    <>
      <SiteHeader
        title="Dashboard"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice title="Loading license data" message="Reading tenants, telemetry, and alerts from the API." />
        ) : error ? (
          <StateNotice title="Dashboard unavailable" message={error} tone="warning" onRetry={refetch} />
        ) : data ? (
          <>
            <SectionCards summary={data.summary} />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {/* Triage first: tenants in grace, hard-blocked, over limit, or with
                  a trial about to expire — the licenses an operator acts on. */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Needs attention</CardTitle>
                    <CardDescription>
                      {attention.length > 0
                        ? `${attention.length} license${attention.length === 1 ? '' : 's'} over limit, blocked, or expiring`
                        : 'No licenses require action'}
                    </CardDescription>
                  </div>
                  <Button render={<Link to="/licenses" />} nativeButton={false} variant="ghost" size="sm">
                    View all
                  </Button>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Issue</TableHead>
                        <TableHead className="w-44">Usage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attention.slice(0, 6).map(({ tenant, info }) => (
                        <TableRow key={tenant.id}>
                          <TableCell className="font-medium">
                            <Link
                              to="/licenses/$id"
                              params={{ id: tenant.id }}
                              className="hover:underline"
                            >
                              {tenant.organizationName}
                            </Link>
                            <div className="text-xs text-muted-foreground">{tenant.keyPrefix}…</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={TONE_BADGE[info.tone]}>{info.label}</Badge>
                            <div className="mt-1 text-xs text-muted-foreground">{info.detail}</div>
                          </TableCell>
                          <TableCell>
                            <UsageMeter used={tenant.usedUnits} limit={tenant.limitUnits} showNumbers={false} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {attention.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                            All {formatNumber(data.summary.totalTenants)} licenses are healthy.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Recent telemetry</CardTitle>
                    <CardDescription>Latest authorize / usage events across all tenants</CardDescription>
                  </div>
                  <Button render={<Link to="/usage" />} nativeButton={false} variant="ghost" size="sm">
                    View all
                  </Button>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead className="text-right">Pages</TableHead>
                        <TableHead className="text-right">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.telemetry.slice(0, 6).map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="font-medium">
                            <Link
                              to="/customers/$id"
                              params={{ id: event.accountId }}
                              className="underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {event.organizationName}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm">{activityLabel(event.status)}</span>
                              <TelemetryBadge status={event.status} />
                            </div>
                            {event.errorCode ? (
                              <div className="mt-0.5 font-mono text-xs text-destructive">{event.errorCode}</div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(event.pages)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {formatDateTime(event.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.telemetry.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                            No telemetry recorded yet.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </PageContainer>
    </>
  )
}
