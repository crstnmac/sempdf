import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { SiteHeader } from '#/components/site-header.tsx'
import { PageContainer, Pager, StateNotice, TableSkeleton } from '#/components/page-shell.tsx'
import { NewCustomerSheet } from '#/components/new-customer-sheet.tsx'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent } from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table.tsx'
import { useAsync } from '#/hooks/use-async.ts'
import { type AdminOrganization, api, formatDate, formatNumber } from '#/lib/api.ts'

export const Route = createFileRoute('/_admin/customers')({ component: CustomersPage })

const PAGE_SIZE = 25

function CustomersPage() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const params = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, q: query.trim() || undefined }),
    [page, query],
  )
  const { data, loading, error, refetch } = useAsync(() => api.organizations(params), [JSON.stringify(params)])

  const orgs = data?.rows ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <SiteHeader
        title="Customers"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refetch}>
              Refresh
            </Button>
            <NewCustomerSheet onCreated={refetch} />
          </>
        }
      />
      <PageContainer>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder="Search company, slug, or owner email…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            className="sm:max-w-sm"
          />
          <span className="text-sm text-muted-foreground sm:ml-auto">
            {formatNumber(total)} customer{total === 1 ? '' : 's'}
          </span>
        </div>

        {loading && !data ? (
          <TableSkeleton columns={5} />
        ) : error ? (
          <StateNotice title="Customers unavailable" message={error} tone="warning" onRetry={refetch} />
        ) : (
          <>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead className="text-center">Members</TableHead>
                      <TableHead>Licenses</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgs.map((org) => (
                      <TableRow key={org.id}>
                        <TableCell className="font-medium">
                          {org.name}
                          <div className="font-mono text-xs text-muted-foreground">{org.slug}</div>
                        </TableCell>
                        <TableCell>
                          {org.ownerEmail ? (
                            <div>
                              {org.ownerName ? <div className="text-sm">{org.ownerName}</div> : null}
                              <a
                                href={`mailto:${org.ownerEmail}`}
                                className="text-xs text-muted-foreground hover:underline"
                              >
                                {org.ownerEmail}
                              </a>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No owner</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{org.memberCount}</TableCell>
                        <TableCell>
                          <LicenseSummary org={org} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(org.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                    {orgs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                          {query.trim()
                            ? 'No customers match your search.'
                            : 'No customers yet — create one with “New customer”.'}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Pager page={page} lastPage={lastPage} loading={loading} onPage={setPage} />
          </>
        )}
      </PageContainer>
    </>
  )
}

/** Compact license status breakdown for a customer. */
function LicenseSummary({ org }: { org: AdminOrganization }) {
  if (org.licenseCount === 0) {
    return <span className="text-xs text-muted-foreground">None</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {org.activeCount > 0 ? <Badge variant="secondary">{org.activeCount} active</Badge> : null}
      {org.trialCount > 0 ? <Badge variant="outline">{org.trialCount} trial</Badge> : null}
      {org.blockedCount > 0 ? <Badge variant="destructive">{org.blockedCount} blocked</Badge> : null}
    </div>
  )
}
