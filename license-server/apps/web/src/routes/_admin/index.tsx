import { Link, createFileRoute } from '@tanstack/react-router'

import { SectionCards } from '#/components/section-cards.tsx'
import { SiteHeader } from '#/components/site-header.tsx'
import {
  PageContainer,
  StateNotice,
  StatusBadge,
  TelemetryBadge,
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
import { api, formatDateTime, formatNumber } from '#/lib/api.ts'

export const Route = createFileRoute('/_admin/')({ component: DashboardPage })

function DashboardPage() {
  const { data, loading, error, refetch } = useAsync(() => api.dashboard())

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
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Recent licenses</CardTitle>
                    <CardDescription>Newest tenants by creation date</CardDescription>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/licenses">View all</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Used / Limit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.tenants.slice(0, 6).map((tenant) => (
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
                            <StatusBadge status={tenant.status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(tenant.usedUnits)} / {formatNumber(tenant.limitUnits)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.tenants.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground">
                            No licenses issued yet.
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
                    <CardDescription>Latest authorize / usage events</CardDescription>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/usage">View all</Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Endpoint</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Pages</TableHead>
                        <TableHead className="text-right">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.telemetry.slice(0, 6).map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="font-mono text-xs">{event.endpoint}</TableCell>
                          <TableCell>
                            <TelemetryBadge status={event.status} />
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
                          <TableCell colSpan={4} className="text-center text-muted-foreground">
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
