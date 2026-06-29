import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { UserCircleIcon } from 'lucide-react'

import { SiteHeader } from '#/components/site-header.tsx'
import { PageContainer, StateNotice, StatusBadge, UsageMeter } from '#/components/page-shell.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { useAsync } from '#/hooks/use-async.ts'
import { ApiError, type PortalLicense, formatDate, formatNumber, portalApi, relativeDays } from '#/lib/api.ts'
import { RequireOrgAdmin, useActiveOrg } from '#/lib/portal-org.tsx'

export const Route = createFileRoute('/portal/settings')({
  component: () => (
    <RequireOrgAdmin>
      <PortalSettingsPage />
    </RequireOrgAdmin>
  ),
})

function PortalSettingsPage() {
  const { activeOrg, activeOrgId } = useActiveOrg()
  const { data: overview } = useAsync(() => portalApi.overview())
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)

  // Licenses belonging to the active organization, for the plan summary.
  const orgLicenses = useMemo(
    () => (overview?.licenses ?? []).filter((lic) => lic.accountId === activeOrgId),
    [overview, activeOrgId],
  )

  // Seed the form from the active org (and re-seed when it changes).
  useEffect(() => {
    setName(activeOrg?.name ?? '')
    setSlug(activeOrg?.slug ?? '')
  }, [activeOrg?.id, activeOrg?.name, activeOrg?.slug])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!activeOrgId) return
    setSaving(true)
    try {
      await portalApi.updateOrg(activeOrgId, { name: name.trim(), slug: slug.trim() })
      toast.success('Organization updated. Refresh to see the new name everywhere.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update organization.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SiteHeader title="Settings" />
      <PageContainer>
        {!activeOrg ? (
          <StateNotice title="No organization" message="Select an organization to edit its profile." />
        ) : (
          <div className="flex max-w-2xl flex-col gap-6">
          {orgLicenses.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Plan</CardTitle>
                <CardDescription>
                  Current plan for {activeOrg.name}. Manage keys and usage on the{' '}
                  <Link to="/portal" className="underline underline-offset-4">
                    overview
                  </Link>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {orgLicenses.map((lic) => (
                  <PlanSummary key={lic.id} lic={lic} />
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Your account</CardTitle>
                <CardDescription>Change your name or password.</CardDescription>
              </div>
              <Button render={<Link to="/portal/account" />} nativeButton={false} variant="outline" size="sm">
                <UserCircleIcon />
                Account
              </Button>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organization profile</CardTitle>
              <CardDescription>
                Update how {activeOrg.name} appears. The slug must be unique.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-5" onSubmit={save}>
                <div className="grid gap-1.5">
                  <Label htmlFor="org-name">Name</Label>
                  <Input
                    id="org-name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="org-slug">Slug</Label>
                  <Input
                    id="org-slug"
                    required
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Account ID</Label>
                  <code className="rounded-md border border-border bg-muted-surface px-3 py-2 text-xs break-all">
                    {activeOrg.id}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    Your operator uses this ID to provision licenses.
                  </p>
                </div>
                <div>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          </div>
        )}
      </PageContainer>
    </>
  )
}

/** Compact plan line for the settings page: status, limit, and term date. */
function PlanSummary({ lic }: { lic: PortalLicense }) {
  const termLine =
    lic.status === 'trial'
      ? lic.trialEndsAt
        ? `Trial ends ${formatDate(lic.trialEndsAt)} · ${relativeDays(lic.trialEndsAt)}`
        : 'Trial'
      : lic.resetAt
        ? `Renews ${formatDate(lic.resetAt)} · ${relativeDays(lic.resetAt)}`
        : 'Lifetime license'
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {formatNumber(lic.limitUnits)} pages / {lic.window === 'year' ? 'year' : 'lifetime'}
          </span>
          <StatusBadge status={lic.status} />
        </div>
        <span className="text-xs text-muted-foreground">{termLine}</span>
      </div>
      <UsageMeter used={lic.usedUnits} limit={lic.limitUnits} />
    </div>
  )
}
