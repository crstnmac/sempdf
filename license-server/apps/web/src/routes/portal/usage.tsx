import { createFileRoute } from '@tanstack/react-router'

import { SiteHeader } from '#/components/site-header.tsx'
import { PageContainer, StateNotice, TelemetryBadge } from '#/components/page-shell.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent } from '#/components/ui/card.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table.tsx'
import { useAsync } from '#/hooks/use-async.ts'
import { formatDateTime, formatNumber, portalApi } from '#/lib/api.ts'

export const Route = createFileRoute('/portal/usage')({ component: PortalUsagePage })

function PortalUsagePage() {
  const { data, loading, error, refetch } = useAsync(() => portalApi.overview())
  const rows = data?.telemetry ?? []
  const totalPages = rows.reduce((sum, event) => sum + event.pages, 0)

  return (
    <>
      <SiteHeader
        title="Usage"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice title="Loading usage" message="Fetching your recent activity." />
        ) : error ? (
          <StateNotice title="Unavailable" message={error} tone="warning" onRetry={refetch} />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm text-muted-foreground">
                <span>Recent activity</span>
                <span>
                  {formatNumber(rows.length)} events · {formatNumber(totalPages)} pages
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.organizationName}</TableCell>
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
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No usage recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </>
  )
}
