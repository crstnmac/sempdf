import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card.tsx'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart.tsx'
import { useAsync } from '#/hooks/use-async.ts'
import { formatNumber, portalApi } from '#/lib/api.ts'

const chartConfig = {
  pages: { label: 'Pages', color: 'var(--primary)' },
} satisfies ChartConfig

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** Pages generated per day over the last 30 days, across the caller's orgs. */
export function UsageTrend() {
  const { data, loading, error } = useAsync(() => portalApi.usageSeries(30))
  const series = data?.series ?? []
  const total = series.reduce((sum, d) => sum + d.pages, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage trend</CardTitle>
        <CardDescription>
          {total > 0
            ? `${formatNumber(total)} pages generated in the last 30 days`
            : 'Pages generated per day, last 30 days'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[200px] animate-pulse rounded-md bg-muted-surface" />
        ) : error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Usage trend unavailable right now.
          </p>
        ) : total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No pages generated in the last 30 days.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <AreaChart data={series} margin={{ left: 4, right: 4, top: 4 }}>
              <defs>
                <linearGradient id="fillPages" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-pages)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-pages)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={shortDate}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => shortDate(String(value))}
                    formatter={(value) => `${formatNumber(Number(value))} pages`}
                  />
                }
              />
              <Area
                dataKey="pages"
                type="monotone"
                fill="url(#fillPages)"
                stroke="var(--color-pages)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
