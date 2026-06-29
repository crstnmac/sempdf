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
  WatermarkBadge,
} from "#/components/page-shell.tsx";
import { UserPlusIcon } from "lucide-react";

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
import {
  type DashboardTenant,
  type TenantStatus,
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
  { value: "all", label: "All statuses" },
  { value: "trial", label: "Trial" },
  { value: "none", label: "Active" },
  { value: "hard_blocked", label: "Hard blocked" },
];

const PAGE_SIZE = 25;

function LicensesPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TenantStatus | "all">("all");
  const [page, setPage] = useState(1);

  const params = useMemo(
    () => ({ page, pageSize: PAGE_SIZE, q: query.trim() || undefined, status }),
    [page, query, status],
  );
  const { data, loading, error, refetch } = useAsync(
    () => api.licenses(params),
    [JSON.stringify(params)],
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
                />
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus((value as TenantStatus | "all") ?? "all");
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="sm:w-48">
                    <SelectValue>
                      {STATUS_FILTERS.find((f) => f.value === status)?.label ??
                        "All statuses"}
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
                <span className="text-sm text-muted-foreground sm:ml-auto">
                  {formatNumber(total)} total
                </span>
                <Button variant="outline" size="sm" onClick={refetch}>
                  Refresh
                </Button>
                <Button size="sm" render={<Link to="/customers/new" />}>
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
                      <WatermarkBadge status={tenant.status} />
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
