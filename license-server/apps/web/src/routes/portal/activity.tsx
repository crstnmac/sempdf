import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

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
  type TelemetryStatus,
  activityLabel,
  formatDateTime,
  formatNumber,
  portalApi,
} from "#/lib/api.ts";

export const Route = createFileRoute("/portal/activity")({
  component: ActivityPage,
});

const STATUS_FILTERS: { value: TelemetryStatus | "all"; label: string }[] = [
  { value: "all", label: "All results" },
  { value: "success", label: "Generated" },
  { value: "watermarked", label: "Watermarked" },
  { value: "blocked", label: "Blocked" },
  { value: "fail", label: "Failed" },
];

const PAGE_SIZE = 25;

function ActivityPage() {
  const [status, setStatus] = useState<TelemetryStatus | "all">("all");
  const [page, setPage] = useState(1);
  const { data, loading, error, refetch } = useAsync(
    () => portalApi.activity({ page, pageSize: PAGE_SIZE, status }),
    [page, status],
  );

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <SiteHeader
        title="Activity"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        }
      />
      <PageContainer>
        {error ? (
          <StateNotice
            title="Activity unavailable"
            message={error}
            tone="warning"
            onRetry={refetch}
          />
        ) : (
          <>
            <TableBlock
              toolbar={
                <Toolbar>
                  <Select
                    value={status}
                    onValueChange={(v) => {
                      setStatus((v as TelemetryStatus | "all") ?? "all");
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="sm:w-48">
                      <SelectValue>
                        {STATUS_FILTERS.find((f) => f.value === status)
                          ?.label ?? "All results"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground sm:ml-auto">
                    {loading && !data
                      ? "Loading…"
                      : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
                  </span>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right">Pages</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">
                        {activityLabel(event.status)}
                        {event.errorCode ? (
                          <div className="font-mono text-xs text-destructive">
                            {event.errorCode}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <TelemetryBadge status={event.status} />
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                        {event.jobDescription ?? event.jobId ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(event.pages)}
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
                        {formatDateTime(event.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-8 text-center text-muted-foreground"
                      >
                        {status === "all"
                          ? "No activity yet — generate your first PDF to see events here."
                          : "No events match this filter."}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableBlock>
          </>
        )}
      </PageContainer>
    </>
  );
}
