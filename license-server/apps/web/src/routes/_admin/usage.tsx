import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { SiteHeader } from '#/components/site-header.tsx'
import { PageContainer, StateNotice, TelemetryBadge } from '#/components/page-shell.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent } from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table.tsx'
import { useAsync } from '#/hooks/use-async.ts'
import { type TelemetryStatus, api, formatDateTime, formatNumber } from '#/lib/api.ts'

export const Route = createFileRoute('/_admin/usage')({ component: UsagePage })

const STATUS_FILTERS: { value: TelemetryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'watermarked', label: 'Watermarked' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'fail', label: 'Fail' },
]

function UsagePage() {
  const { data, loading, error, refetch } = useAsync(() => api.dashboard())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<TelemetryStatus | 'all'>('all')

  const rows = useMemo(() => {
    const all = data?.telemetry ?? []
    const q = query.trim().toLowerCase()
    return all.filter((event) => {
      if (status !== 'all' && event.status !== status) return false
      if (!q) return true
      return (
        event.accountId.toLowerCase().includes(q) ||
        event.endpoint.toLowerCase().includes(q) ||
        (event.jobId ?? '').toLowerCase().includes(q)
      )
    })
  }, [data, query, status])

  const totalPages = useMemo(() => rows.reduce((sum, event) => sum + event.pages, 0), [rows])

  return (
    <>
      <SiteHeader
        title="Usage & telemetry"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice title="Loading telemetry" message="Fetching recent events from the API." />
        ) : error ? (
          <StateNotice title="Telemetry unavailable" message={error} tone="warning" onRetry={refetch} />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search account, endpoint, or job…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="sm:max-w-xs"
              />
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as TelemetryStatus | 'all')}
              >
                <SelectTrigger className="sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground sm:ml-auto">
                {formatNumber(rows.length)} events · {formatNumber(totalPages)} pages
              </span>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
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
                        <TableCell className="font-medium">
                          <Link
                            to="/licenses/$id"
                            params={{ id: event.licenseId }}
                            className="hover:underline"
                          >
                            {event.organizationName}
                          </Link>
                        </TableCell>
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
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No telemetry matches the current filters.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </PageContainer>
    </>
  )
}
