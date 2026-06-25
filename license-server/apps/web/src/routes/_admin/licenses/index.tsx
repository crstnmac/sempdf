import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { SiteHeader } from '#/components/site-header.tsx'
import {
  PageContainer,
  StateNotice,
  StatusBadge,
  UsageMeter,
  WatermarkBadge,
} from '#/components/page-shell.tsx'
import { IssueLicenseSheet } from '#/components/issue-license-sheet.tsx'
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
import { type TenantStatus, api, formatDate, formatNumber } from '#/lib/api.ts'

export const Route = createFileRoute('/_admin/licenses/')({ component: LicensesPage })

const STATUS_FILTERS: { value: TenantStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'trial', label: 'Trial' },
  { value: 'none', label: 'Active' },
  { value: 'grace_period', label: 'Grace period' },
  { value: 'hard_blocked', label: 'Hard blocked' },
]

function LicensesPage() {
  const { data, loading, error, refetch } = useAsync(() => api.dashboard())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<TenantStatus | 'all'>('all')

  const tenants = useMemo(() => {
    const all = data?.tenants ?? []
    const q = query.trim().toLowerCase()
    return all.filter((tenant) => {
      if (status !== 'all' && tenant.status !== status) return false
      if (!q) return true
      return (
        tenant.organizationName.toLowerCase().includes(q) ||
        tenant.accountId.toLowerCase().includes(q) ||
        tenant.keyPrefix.toLowerCase().includes(q)
      )
    })
  }, [data, query, status])

  return (
    <>
      <SiteHeader
        title="Licenses"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refetch}>
              Refresh
            </Button>
            <IssueLicenseSheet onCreated={refetch} />
          </>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice title="Loading licenses" message="Fetching tenants from the API." />
        ) : error ? (
          <StateNotice title="Licenses unavailable" message={error} tone="warning" onRetry={refetch} />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="Search account or key prefix…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={status} onValueChange={(value) => setStatus(value as TenantStatus | 'all')}>
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
                {formatNumber(tenants.length)} shown
              </span>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Watermark</TableHead>
                      <TableHead className="w-56">Usage</TableHead>
                      <TableHead>Window</TableHead>
                      <TableHead>Trial ends</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenants.map((tenant) => (
                      <TableRow key={tenant.id}>
                        <TableCell className="font-medium">
                          <Link
                            to="/licenses/$id"
                            params={{ id: tenant.id }}
                            className="hover:underline"
                          >
                            {tenant.organizationName}
                          </Link>
                          <div className="font-mono text-xs text-muted-foreground">
                            {tenant.keyPrefix}…
                          </div>
                          {!tenant.active ? (
                            <span className="text-xs text-destructive">revoked</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={tenant.status} />
                        </TableCell>
                        <TableCell>
                          <WatermarkBadge status={tenant.status} />
                        </TableCell>
                        <TableCell>
                          <UsageMeter used={tenant.usedUnits} limit={tenant.limitUnits} />
                        </TableCell>
                        <TableCell className="capitalize">{tenant.window}</TableCell>
                        <TableCell>{formatDate(tenant.trialEndsAt)}</TableCell>
                      </TableRow>
                    ))}
                    {tenants.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No licenses match the current filters.
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
