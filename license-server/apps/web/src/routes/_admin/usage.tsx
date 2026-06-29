import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon } from "lucide-react";

import { SiteHeader } from "#/components/site-header.tsx";
import {
  PageContainer,
  Pager,
  StateNotice,
  TableBlock,
  TelemetryBadge,
  Toolbar,
} from "#/components/page-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
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
  type TelemetryRow,
  type TelemetryStatus,
  api,
  formatDateTime,
  formatNumber,
} from "#/lib/api.ts";

export const Route = createFileRoute("/_admin/usage")({ component: UsagePage });

const STATUS_FILTERS: { value: TelemetryStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "watermarked", label: "Watermarked" },
  { value: "blocked", label: "Blocked" },
  { value: "fail", label: "Fail" },
];

const PERIODS: { value: string; label: string; hours: number | null }[] = [
  { value: "today", label: "Today", hours: 24 },
  { value: "7d", label: "Last 7 days", hours: 168 },
  { value: "30d", label: "Last 30 days", hours: 720 },
  { value: "all", label: "All time", hours: null },
];

type SortKey = "createdAt" | "pages" | "status" | "endpoint";
type SortDir = "asc" | "desc";

function csvRow(row: TelemetryRow): string {
  return [
    row.organizationName,
    row.endpoint,
    row.status,
    String(row.pages),
    row.jobDescription ?? row.jobId ?? "",
    row.platform ?? "",
    row.libVersion ?? "",
    row.tagged === null ? "" : row.tagged ? "tagged" : "untagged",
    row.conformance ?? "",
    row.language ?? "",
    row.createdAt,
  ]
    .map((v) => `"${v.replace(/"/g, '""')}"`)
    .join(",");
}

function UsagePage() {
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState("7d");
  const [statusFilter, setStatusFilter] = useState<TelemetryStatus | "all">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<number | null>(null);

  const from = useMemo(() => {
    const opt = PERIODS.find((p) => p.value === period);
    if (!opt?.hours) return undefined;
    return new Date(Date.now() - opt.hours * 3600000).toISOString();
  }, [period]);

  const params = useMemo(
    () => ({
      page,
      pageSize: 50,
      from,
      status: statusFilter === "all" ? undefined : statusFilter,
      q: query.trim() || undefined,
    }),
    [page, from, statusFilter, query],
  );

  const { data, loading, error, refetch } = useAsync(
    () => api.telemetry(params),
    [JSON.stringify(params)],
  );

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.rows];
    sorted.sort((a, b) => {
      const av = a[sort],
        bv = b[sort];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, sort, sortDir]);

  const totalPages = Math.ceil((data?.total ?? 0) / params.pageSize);

  function toggleSort(key: SortKey) {
    if (sort === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sort !== column) return null;
    return sortDir === "asc" ? (
      <ArrowUpIcon className="inline size-3" />
    ) : (
      <ArrowDownIcon className="inline size-3" />
    );
  }

  async function exportCsv() {
    const acc = [
      '"Org","Endpoint","Status","Pages","Job","Platform","Version","Tagged","Conformance","Language","When"',
    ];
    let p = 1;
    while (true) {
      const res = await api.telemetry({
        page: p,
        pageSize: 200,
        from,
        status: statusFilter === "all" ? undefined : statusFilter,
        q: query.trim() || undefined,
      });
      for (const row of res.rows) acc.push(csvRow(row));
      if (p * 200 >= res.total) break;
      p++;
    }
    const blob = new Blob([acc.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <SiteHeader
        title="Usage & telemetry"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <DownloadIcon /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={refetch}>
              Refresh
            </Button>
          </>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice
            title="Loading telemetry"
            message="Fetching events from the API."
          />
        ) : error ? (
          <StateNotice
            title="Telemetry unavailable"
            message={error}
            tone="warning"
            onRetry={refetch}
          />
        ) : (
          <>
            {data?.summary ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MetricCard
                  label="Pages"
                  value={formatNumber(data.summary.totalPages)}
                  hint=" Matching filters"
                />
                <MetricCard
                  label="Errors"
                  value={formatNumber(data.summary.errorCount)}
                  hint="Blocked or failed"
                  tone={data.summary.errorCount > 0 ? "destructive" : undefined}
                />
                <MetricCard
                  label="Watermarked"
                  value={formatNumber(data.summary.watermarkedCount)}
                  hint="Over-limit / trial"
                />
                <MetricCard
                  label="Orgs"
                  value={formatNumber(data.summary.uniqueOrgs)}
                  hint=" Active customers"
                />
              </div>
            ) : null}

            <TableBlock
              toolbar={
                <Toolbar>
                  <Select
                    value={period}
                    onValueChange={(v) => {
                      setPeriod(v ?? period);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="sm:w-36">
                      <SelectValue>
                        {PERIODS.find((o) => o.value === period)?.label ??
                          "Select period"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PERIODS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => {
                      setStatusFilter(v as TelemetryStatus | "all");
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="sm:w-44">
                      <SelectValue>
                        {STATUS_FILTERS.find((o) => o.value === statusFilter)
                          ?.label ?? "All statuses"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Search org, endpoint, or job…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(1);
                    }}
                    className="sm:max-w-xs"
                  />
                  <span className="text-sm text-muted-foreground sm:ml-auto">
                    {formatNumber(data?.total ?? 0)} events
                  </span>
                </Toolbar>
              }
              footer={
                totalPages > 1 ? (
                  <Pager page={page} lastPage={totalPages} onPage={setPage} />
                ) : undefined
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("endpoint")}
                    >
                      Endpoint <SortIcon column="endpoint" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("status")}
                    >
                      Status <SortIcon column="status" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none text-right"
                      onClick={() => toggleSort("pages")}
                    >
                      Pages <SortIcon column="pages" />
                    </TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead
                      className="cursor-pointer select-none text-right"
                      onClick={() => toggleSort("createdAt")}
                    >
                      When <SortIcon column="createdAt" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">
                        {event.organizationName}
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {event.licenseId.slice(0, 8)}…
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {event.endpoint}
                      </TableCell>
                      <TableCell>
                        <TelemetryBadge status={event.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(event.pages)}
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground max-w-32 truncate"
                        title={event.jobDescription ?? event.jobId ?? undefined}
                      >
                        {event.jobDescription ?? event.jobId ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        <span
                          className="cursor-pointer hover:underline"
                          onClick={() =>
                            setExpanded(expanded === event.id ? null : event.id)
                          }
                        >
                          {formatDateTime(event.createdAt)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {sortedRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground py-8"
                      >
                        No telemetry matches the current filters.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableBlock>

            {sortedRows.some((r) => expanded === r.id) ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Event detail</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-1">
                  {(() => {
                    const row = sortedRows.find((r) => r.id === expanded);
                    if (!row) return null;
                    return (
                      <>
                        <div>Platform: {row.platform ?? "—"}</div>
                        <div>
                          Library: {row.libVersion ? `v${row.libVersion}` : "—"}
                        </div>
                        <div>Node: {row.nodeVersion ?? "—"}</div>
                        <div>
                          A11y:{" "}
                          {row.tagged === null
                            ? "—"
                            : `${row.tagged ? "tagged" : "untagged"}${row.conformance ? ` · ${row.conformance}` : ""}${row.language ? ` · ${row.language}` : ""}`}
                        </div>
                        {row.errorCode ? (
                          <div>Error: {row.errorCode}</div>
                        ) : null}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </PageContainer>
    </>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "destructive";
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={`text-2xl font-semibold tabular-nums ${tone === "destructive" ? "text-destructive" : ""}`}
        >
          {value}
        </CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {hint}
        </CardContent>
      ) : null}
    </Card>
  );
}
