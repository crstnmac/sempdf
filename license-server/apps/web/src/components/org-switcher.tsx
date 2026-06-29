import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { useActiveOrg } from '#/lib/portal-org.tsx'

/** Switches the organization the portal pages act on. */
export function OrgSwitcher() {
  const { orgs, activeOrg, activeOrgId, setActiveOrgId, loading } = useActiveOrg()

  if (loading) {
    return <div className="h-9 w-full animate-pulse rounded-lg bg-sidebar-accent" />
  }

  if (orgs.length <= 1) {
    return (
      <div className="min-w-0 px-1">
        <span className="block truncate text-sm font-semibold text-sidebar-foreground">
          {activeOrg?.name ?? 'Organization'}
        </span>
        <span className="block truncate text-xs text-sidebar-foreground/60">A11yDocs</span>
      </div>
    )
  }

  return (
    <Select value={activeOrgId ?? undefined} onValueChange={(v) => v && setActiveOrgId(v)}>
      <SelectTrigger
        aria-label="Switch organization"
        className="h-8 w-full border-0 bg-transparent px-2 shadow-none hover:bg-sidebar-accent focus-visible:ring-sidebar-ring"
      >
        <SelectValue placeholder="Select organization">
          <span className="block min-w-0 text-left">
            <span className="block truncate text-sm font-semibold text-sidebar-foreground">
              {activeOrg?.name ?? 'Select organization'}
            </span>
            <span className="block truncate text-xs font-normal text-sidebar-foreground/60">
              Organization
            </span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {orgs.map((org) => (
          <SelectItem key={org.id} value={org.id}>
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
