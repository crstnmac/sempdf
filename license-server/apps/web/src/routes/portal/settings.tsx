import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { SiteHeader } from '#/components/site-header.tsx'
import { PageContainer, StateNotice } from '#/components/page-shell.tsx'
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
import { ApiError, portalApi } from '#/lib/api.ts'
import { useActiveOrg } from '#/lib/portal-org.tsx'

export const Route = createFileRoute('/portal/settings')({ component: PortalSettingsPage })

function PortalSettingsPage() {
  const { activeOrg, activeOrgId } = useActiveOrg()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)

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
          <Card className="max-w-2xl">
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
        )}
      </PageContainer>
    </>
  )
}
