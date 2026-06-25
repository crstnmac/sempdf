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
  const { orgs, activeOrgId, setActiveOrgId } = useActiveOrg()
  if (orgs.length <= 1) return null

  return (
    <Select value={activeOrgId ?? undefined} onValueChange={setActiveOrgId}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select organization" />
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
