import { useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, UserPlusIcon } from "lucide-react";

import { SiteHeader } from "#/components/site-header.tsx";
import {
  ListContainer,
  Pager,
  ScrollTableCard,
  StateNotice,
  TableSkeleton,
  Toolbar,
} from "#/components/page-shell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { useAsync } from "#/hooks/use-async.ts";
import { useDebouncedValue } from "#/hooks/use-debounced-value.ts";
import {
  type AdminOrganization,
  type OrganizationLicenseFilter,
  api,
  formatDate,
  formatNumber,
} from "#/lib/api.ts";

export const Route = createFileRoute("/_admin/customers/")({
  component: CustomersPage,
});

const PAGE_SIZE = 25;
const LICENSE_FILTERS: {
  value: OrganizationLicenseFilter;
  label: string;
}[] = [
  { value: "all", label: "All license states" },
  { value: "active", label: "Active paid" },
  { value: "trial", label: "Trial" },
  { value: "hard_blocked", label: "Hard blocked" },
  { value: "revoked", label: "Revoked" },
  { value: "none", label: "No license" },
];
const CREATED_FILTERS = [
  { value: "all", label: "Any signup date", days: null },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "1y", label: "Last year", days: 365 },
] as const;

function CustomersPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [license, setLicense] =
    useState<OrganizationLicenseFilter>("all");
  const [created, setCreated] = useState<(typeof CREATED_FILTERS)[number]["value"]>(
    "all",
  );
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query, 300);
  const createdAfter = useMemo(() => {
    const days = CREATED_FILTERS.find((filter) => filter.value === created)?.days;
    return days
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
  }, [created]);

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQuery.trim() || undefined,
      license,
      createdAfter,
    }),
    [page, debouncedQuery, license, createdAfter],
  );
  const { data, loading, error, refetch } = useAsync(
    () => api.organizations(params),
    [JSON.stringify(params)],
  );

  const orgs = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(query.trim()) || license !== "all" || created !== "all";

  return (
    <>
      <SiteHeader title="Customers" />
      <ListContainer>
        {loading && !data ? (
          <TableSkeleton columns={5} />
        ) : error ? (
          <StateNotice
            title="Customers unavailable"
            message={error}
            tone="warning"
            onRetry={refetch}
          />
        ) : (
          <ScrollTableCard
            toolbar={
              <Toolbar>
                <Input
                  placeholder="Search company, slug, or owner email…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  className="sm:max-w-sm"
                  aria-label="Search customers"
                />
                <Select
                  value={license}
                  onValueChange={(value) => {
                    setLicense(
                      (value as OrganizationLicenseFilter | null) ?? "all",
                    );
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    className="sm:w-44"
                    aria-label="Filter customers by license state"
                  >
                    <SelectValue>
                      {LICENSE_FILTERS.find((filter) => filter.value === license)
                        ?.label ?? "All license states"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LICENSE_FILTERS.map((filter) => (
                      <SelectItem key={filter.value} value={filter.value}>
                        {filter.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={created}
                  onValueChange={(value) => {
                    setCreated(
                      (value as (typeof CREATED_FILTERS)[number]["value"] | null) ??
                        "all",
                    );
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    className="sm:w-40"
                    aria-label="Filter customers by signup date"
                  >
                    <SelectValue>
                      {CREATED_FILTERS.find((filter) => filter.value === created)
                        ?.label ?? "Any signup date"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CREATED_FILTERS.map((filter) => (
                      <SelectItem key={filter.value} value={filter.value}>
                        {filter.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasFilters ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setLicense("all");
                      setCreated("all");
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
                <span className="text-sm text-muted-foreground sm:ml-auto">
                  {formatNumber(total)} customer{total === 1 ? "" : "s"}
                </span>
                <Button variant="outline" size="sm" onClick={refetch}>
                  Refresh
                </Button>
                <Button
                  nativeButton={false}
                  size="sm"
                  render={<Link to="/customers/new" />}
                >
                  <UserPlusIcon />
                  New customer
                </Button>
              </Toolbar>
            }
            footer={
              lastPage > 1 ? (
                <Pager
                  page={page}
                  lastPage={lastPage}
                  loading={loading}
                  onPage={setPage}
                />
              ) : undefined
            }
          >
            <Table containerClassName="h-full">
              <TableHeader className="sticky top-0 z-10 bg-card">
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
                  <TableRow
                    key={org.id}
                    className="group cursor-pointer"
                    onClick={(event) => {
                      if (
                        event.target instanceof HTMLElement &&
                        event.target.closest("a, button, input, select, textarea")
                      ) {
                        return;
                      }
                      void navigate({
                        to: "/customers/$id",
                        params: { id: org.id },
                      });
                    }}
                  >
                    <TableCell className="font-medium">
                      <Link
                        to="/customers/$id"
                        params={{ id: org.id }}
                        className="inline-flex items-center gap-1.5 underline-offset-4 group-hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {org.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">
                        {org.slug}
                      </div>
                    </TableCell>
                    <TableCell>
                      {org.ownerEmail ? (
                        <div>
                          {org.ownerName ? (
                            <div className="text-sm">{org.ownerName}</div>
                          ) : null}
                          <a
                            href={`mailto:${org.ownerEmail}`}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            {org.ownerEmail}
                          </a>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No owner
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {org.memberCount}
                    </TableCell>
                    <TableCell>
                      <LicenseSummary org={org} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        {formatDate(org.createdAt)}
                        <ChevronRightIcon
                          aria-hidden="true"
                          className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {orgs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {hasFilters
                        ? "No customers match the current filters."
                        : "No customers yet — create one with “New customer”."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </ScrollTableCard>
        )}
      </ListContainer>
    </>
  );
}

/** Compact license status breakdown for a customer. */
function LicenseSummary({ org }: { org: AdminOrganization }) {
  if (org.licenseCount === 0) {
    return <span className="text-xs text-muted-foreground">None</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {org.activeCount > 0 ? (
        <Badge variant="secondary">{org.activeCount} active</Badge>
      ) : null}
      {org.trialCount > 0 ? (
        <Badge variant="outline">{org.trialCount} trial</Badge>
      ) : null}
      {org.blockedCount > 0 ? (
        <Badge variant="destructive">{org.blockedCount} blocked</Badge>
      ) : null}
      {org.revokedCount > 0 ? (
        <Badge variant="outline">{org.revokedCount} revoked</Badge>
      ) : null}
    </div>
  );
}
