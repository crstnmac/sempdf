import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card.tsx'
import { Badge } from '#/components/ui/badge.tsx'
import { type DashboardSummary, formatNumber } from '#/lib/api.ts'

export function SectionCards({ summary }: { summary: DashboardSummary }) {
  const cards: {
    label: string
    value: string
    hint: string
    badge?: 'outline' | 'destructive'
  }[] = [
    {
      label: 'Total licenses',
      value: formatNumber(summary.totalTenants),
      hint: `${formatNumber(summary.trialTenants)} on trial`,
    },
    {
      label: 'Pages metered',
      value: formatNumber(summary.pagesUsed),
      hint: 'Charged across all licenses',
    },
    {
      label: 'On trial',
      value: formatNumber(summary.trialTenants),
      hint: 'Output watermarked until upgrade',
    },
    {
      label: 'Hard blocked',
      value: formatNumber(summary.hardBlockedTenants),
      hint: 'Generation suspended',
      badge: summary.hardBlockedTenants > 0 ? 'destructive' : undefined,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:px-0 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="@container/card">
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
            {card.badge ? (
              <CardAction>
                <Badge variant={card.badge}>Attention</Badge>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardFooter className="text-sm text-muted-foreground">{card.hint}</CardFooter>
        </Card>
      ))}
    </div>
  )
}
