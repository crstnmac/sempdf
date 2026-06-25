import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  type BadgeTone,
  type TelemetryStatus,
  type TenantStatus,
  formatNumber,
  statusLabel,
  statusTone,
  telemetryTone,
  usagePercent,
  watermarkLabel,
} from '#/lib/api.ts'

export function PageContainer({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">{children}</div>
}

export function StatusBadge({ status }: { status: TenantStatus }) {
  return <Badge variant={statusTone(status) as BadgeTone}>{statusLabel(status)}</Badge>
}

export function TelemetryBadge({ status }: { status: TelemetryStatus }) {
  return <Badge variant={telemetryTone(status) as BadgeTone}>{status}</Badge>
}

/** Shows the watermark a generated PDF gets ("Trial Mode" / "Over Limit"). */
export function WatermarkBadge({ status }: { status: TenantStatus }) {
  const label = watermarkLabel(status)
  if (!label) return null
  return (
    <Badge variant={status === 'grace_period' ? 'destructive' : 'secondary'}>{label}</Badge>
  )
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
  used: number
  limit: number
  showNumbers?: boolean
}) {
  const pct = usagePercent(used, limit)
  const over = used > limit && limit > 0
  const barColor = over || pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-primary'

  return (
    <div className="flex flex-col gap-1">
      {showNumbers ? (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            {formatNumber(used)} / {limit > 0 ? formatNumber(limit) : '∞'} pages
          </span>
          <span className={over ? 'font-medium text-destructive' : ''}>{pct}%</span>
        </div>
      ) : null}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted-surface">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
        {/* 80% alert marker */}
        <span className="absolute top-0 h-full w-px bg-border" style={{ left: '80%' }} />
      </div>
    </div>
  )
}

export function StateNotice({
  title,
  message,
  onRetry,
  tone = 'neutral',
}: {
  title: string
  message: string
  onRetry?: () => void
  tone?: 'neutral' | 'warning'
}) {
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'status'}
      className="rounded-lg border border-border bg-card p-6"
    >
      <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
