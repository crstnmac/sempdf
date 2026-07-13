import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  type BadgeTone,
  type TelemetryStatus,
  type TenantStatus,
  formatNumber,
  isUnlimited,
  statusLabel,
  statusTone,
  telemetryTone,
  usagePercent,
} from "#/lib/api.ts";

export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">{children}</div>
  );
}

/**
 * Full-height page body for list views: fills the space under the sticky header
 * and clamps its own height (`min-h-0`) so a child table can scroll internally
 * instead of growing the page.
 */
export function ListContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6">
      {children}
    </div>
  );
}

/** Search + filters + actions row. Lives inside a block (the table card header). */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
    </div>
  );
}

/**
 * Card wrapper whose body is the table's own scroll area. The `toolbar`
 * (search + filters + actions) and `footer` (pager) render inside the same
 * block — header and footer stay put while rows scroll. Pair the inner
 * `<Table>` with `containerClassName="h-full"` and a sticky `<TableHeader>`.
 */
export function ScrollTableCard({
  toolbar,
  footer,
  children,
}: {
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-h-0 flex-1 gap-0 py-0">
      {toolbar ? <div className="shrink-0 border-b p-3">{toolbar}</div> : null}
      <CardContent className="min-h-0 flex-1 p-0">{children}</CardContent>
      {footer ? <div className="shrink-0 border-t p-3">{footer}</div> : null}
    </Card>
  );
}

/**
 * Like {@link ScrollTableCard} but for page-scroll views (no internal table
 * scroll): the `toolbar` and `footer` (pager) live inside the same block as the
 * table, while the page itself scrolls. Use on pages with other blocks above.
 */
export function TableBlock({
  toolbar,
  footer,
  children,
}: {
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      {toolbar ? <div className="border-b p-3">{toolbar}</div> : null}
      <CardContent className="p-0">{children}</CardContent>
      {footer ? <div className="border-t p-3">{footer}</div> : null}
    </Card>
  );
}

export function StatusBadge({ status }: { status: TenantStatus }) {
  return (
    <Badge variant={statusTone(status) as BadgeTone}>
      {statusLabel(status)}
    </Badge>
  );
}

export function TelemetryBadge({ status }: { status: TelemetryStatus }) {
  return <Badge variant={telemetryTone(status) as BadgeTone}>{status}</Badge>;
}

/**
 * Page-credit consumption bar with 80% and 100% threshold markers — the points
 * where the backend fires usage alerts and starts overage watermarking.
 */
export function UsageMeter({
  used,
  limit,
  showNumbers = true,
}: {
  used: number;
  limit: number;
  showNumbers?: boolean;
}) {
  const unlimited = isUnlimited(limit);
  const pct = unlimited ? 0 : usagePercent(used, limit);
  const over = !unlimited && used > limit && limit > 0;
  const overBy = over ? used - limit : 0;
  const barColor =
    over || pct >= 100
      ? "bg-destructive"
      : pct >= 80
        ? "bg-warning"
        : "bg-primary";

  return (
    <div className="flex flex-col gap-1">
      {showNumbers ? (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            {formatNumber(used)} /{" "}
            {unlimited || limit <= 0 ? "∞" : formatNumber(limit)} pages
          </span>
          {over ? (
            <span className="font-medium text-destructive tabular-nums">
              −{formatNumber(overBy)} over
            </span>
          ) : (
            <span>{unlimited ? "∞" : `${pct}%`}</span>
          )}
        </div>
      ) : null}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted-surface">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
        {/* 80% alert marker */}
        <span
          className="absolute top-0 h-full w-px bg-border"
          style={{ left: "80%" }}
        />
      </div>
    </div>
  );
}

/** Prev/next page controls with a "Page X of Y" label. Hidden when single page. */
export function Pager({
  page,
  lastPage,
  loading,
  onPage,
}: {
  page: number;
  lastPage: number;
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  if (lastPage <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1 || loading}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {lastPage}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= lastPage || loading}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

/** Placeholder rows for a table that's still loading, inside a card. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-col divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                className={c === 0 ? "h-4 flex-1" : "h-4 w-20"}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StateNotice({
  title,
  message,
  onRetry,
  tone = "neutral",
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      className="rounded-lg border border-border bg-card p-6"
    >
      <h2 className="font-heading text-lg font-semibold text-foreground">
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
