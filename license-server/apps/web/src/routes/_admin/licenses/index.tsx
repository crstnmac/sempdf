import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { SiteHeader } from "#/components/site-header.tsx";
import {
  ListContainer,
  Pager,
  ScrollTableCard,
  StateNotice,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  UsageMeter,
} from "#/components/page-shell.tsx";
import { UserPlusIcon } from "lucide-react";

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
  type DashboardTenant,
  type LicenseServiceFilter,
  type LicenseUtilizationFilter,
  type TenantStatus,
  type UsageWindow,
  api,
  formatDate,
  formatNumber,
  relativeDays,
} from "#/lib/api.ts";

export const Route = createFileRoute("/_admin/licenses/")({
  component: LicensesPage,
});

/** Status-aware term date: trials show when the trial ends, paid annual plans
 *  their renewal date, lifetime plans none. */
function termCell(tenant: DashboardTenant): React.ReactNode {
  if (tenant.status === "trial") {
    return tenant.trialEndsAt ? (
      <div>
        {formatDate(tenant.trialEndsAt)}
        <div className="text-xs text-muted-foreground">
          trial · {relativeDays(tenant.trialEndsAt)}
        </div>
      </div>
    ) : (
      "—"
    );
  }
  if (tenant.window === "lifetime")
    return <span className="text-muted-foreground">Lifetime</span>;
  return tenant.expiresAt ? (
    <div>
      {formatDate(tenant.expiresAt)}
      <div className="text-xs text-muted-foreground">
        renews · {relativeDays(tenant.expiresAt)}
      </div>
    </div>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

const STATUS_FILTERS: { value: TenantStatus | "all"; label: string }[] = [
  { value: "all", label: "All billing statuses" },
  { value: "trial", label: "Trial" },
  { value: "none", label: "Paid" },
  { value: "hard_blocked", label: "Hard blocked" },
];
const SERVICE_FILTERS: { value: LicenseServiceFilter; label: string }[] = [
  { value: "all", label: "All service states" },
  { value: "active", label: "Service active" },
  { value: "revoked", label: "Revoked" },
];
const WINDOW_FILTERS: { value: UsageWindow | "all"; label: string }[] = [
  { value: "all", label: "All terms" },
  { value: "year", label: "Annual" },
  { value: "lifetime", label: "Lifetime" },
];
const UTILIZATION_FILTERS: {
  value: LicenseUtilizationFilter;
  label: string;
}[] = [
  { value: "all", label: "Any utilization" },
  { value: "unused", label: "Unused" },
  { value: "near_limit", label: "80%+ used" },
  { value: "over_limit", label: "At / over limit" },
];

const PAGE_SIZE = 25;

function LicensesPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TenantStatus | "all">("all");
  const [service, setService] = useState<LicenseServiceFilter>("all");
  const [window, setWindow] = useState<UsageWindow | "all">("all");
  const [utilization, setUtilization] =
    useState<LicenseUtilizationFilter>("all");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query, 300);

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQuery.trim() || undefined,
      status,
      service,
      window,
      utilization,
    }),
    [page, debouncedQuery, status, service, window, utilization],
  );
  const { data, loading, error, refetch } = useAsync(
    () => api.licenses(params),
    [JSON.stringify(params)],
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    Boolean(query.trim()) ||
    status !== "all" ||
    service !== "all" ||
    window !== "all" ||
    utilization !== "all";

  return (
    <>
      <SiteHeader title="Licenses" />
      <ListContainer>
        {loading && !data ? (
          <TableSkeleton columns={6} />
        ) : error ? (
          <StateNotice
            title="Licenses unavailable"
            message={error}
            tone="warning"
            onRetry={refetch}
          />
        ) : (
          <ScrollTableCard
            toolbar={
              <Toolbar>
                <Input
                  placeholder="Search org, account, or key prefix…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  className="sm:max-w-xs"
                  aria-label="Search licenses"
                />
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus((value as TenantStatus | "all") ?? "all");
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    className="sm:w-44"
                    aria-label="Filter licenses by billing status"
                  >
                    <SelectValue>
                      {STATUS_FILTERS.find((f) => f.value === status)?.label ??
                        "All billing statuses"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={service}
                  onValueChange={(value) => {
                    setService(
                      (value as LicenseServiceFilter | null) ?? "all",
                    );
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    className="sm:w-40"
                    aria-label="Filter licenses by service state"
                  >
                    <SelectValue>
                      {SERVICE_FILTERS.find((f) => f.value === service)?.label ??
                        "All service states"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_FILTERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={window}
                  onValueChange={(value) => {
                    setWindow((value as UsageWindow | "all" | null) ?? "all");
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    className="sm:w-36"
                    aria-label="Filter licenses by term"
                  >
                    <SelectValue>
                      {WINDOW_FILTERS.find((f) => f.value === window)?.label ??
                        "All terms"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {WINDOW_FILTERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={utilization}
                  onValueChange={(value) => {
                    setUtilization(
                      (value as LicenseUtilizationFilter | null) ?? "all",
                    );
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    className="sm:w-40"
                    aria-label="Filter licenses by utilization"
                  >
                    <SelectValue>
                      {UTILIZATION_FILTERS.find(
                        (f) => f.value === utilization,
                      )?.label ?? "Any utilization"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {UTILIZATION_FILTERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
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
                      setStatus("all");
                      setService("all");
                      setWindow("all");
                      setUtilization("all");
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
                <span className="text-sm text-muted-foreground sm:ml-auto">
                  {formatNumber(total)} total
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
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Watermark</TableHead>
                  <TableHead className="w-56">Usage</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Renews / ends</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((tenant) => (
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
                        <span className="text-xs text-destructive">
                          revoked
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={tenant.status} />
                    </TableCell>
                    <TableCell>
                      {tenant.status === "trial" ? (
                        <Badge variant="secondary">On</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Off
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <UsageMeter
                        used={tenant.usedUnits}
                        limit={tenant.limitUnits}
                      />
                    </TableCell>
                    <TableCell>
                      {tenant.window === "year" ? "Annual" : "Lifetime"}
                    </TableCell>
                    <TableCell>{termCell(tenant)}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      No licenses match the current filters.
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
