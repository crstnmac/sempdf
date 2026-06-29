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
import { Checkbox } from '#/components/ui/checkbox.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { ApiError, type NotificationSettings, portalApi } from '#/lib/api.ts'
import { useActiveOrg } from '#/lib/portal-org.tsx'

export const Route = createFileRoute('/portal/notifications')({ component: PortalNotificationsPage })

type FormState = {
  emailTo: string
  webhookUrl: string
  usageSummaryFrequency: 'weekly' | 'monthly'
  usageAlertsEnabled: boolean
  overageAlertsEnabled: boolean
  hardBlockWarningsEnabled: boolean
}

const DEFAULT_FORM: FormState = {
  emailTo: '',
  webhookUrl: '',
  usageSummaryFrequency: 'weekly',
  usageAlertsEnabled: true,
  overageAlertsEnabled: true,
  hardBlockWarningsEnabled: true,
}

function toForm(s: NotificationSettings): FormState {
  return {
    emailTo: s.emailTo ?? '',
    webhookUrl: s.webhookUrl ?? '',
    usageSummaryFrequency:
      s.usageSummaryFrequency === 'monthly' ? 'monthly' : DEFAULT_FORM.usageSummaryFrequency,
    usageAlertsEnabled: s.usageAlertsEnabled ?? DEFAULT_FORM.usageAlertsEnabled,
    overageAlertsEnabled: s.overageAlertsEnabled ?? DEFAULT_FORM.overageAlertsEnabled,
    hardBlockWarningsEnabled:
      s.hardBlockWarningsEnabled ?? DEFAULT_FORM.hardBlockWarningsEnabled,
  }
}

function PortalNotificationsPage() {
  const { activeOrgId } = useActiveOrg()
  const orgId = activeOrgId ?? ''
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    portalApi
      .notificationSettings(orgId)
      .then((s) => {
        if (!cancelled) setForm(s.accountId ? toForm(s) : DEFAULT_FORM)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load settings.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await portalApi.saveNotificationSettings(orgId, {
        emailTo: form.emailTo.trim() || null,
        webhookUrl: form.webhookUrl.trim() || null,
        usageSummaryFrequency: form.usageSummaryFrequency,
        usageAlertsEnabled: form.usageAlertsEnabled,
        overageAlertsEnabled: form.overageAlertsEnabled,
        hardBlockWarningsEnabled: form.hardBlockWarningsEnabled,
      })
      toast.success('Notification settings saved.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SiteHeader title="Notifications" />
      <PageContainer>
        {error ? (
          <StateNotice title="Settings unavailable" message={error} tone="warning" />
        ) : (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Alerts & delivery</CardTitle>
              <CardDescription>
                Where to send usage summaries and limit alerts for this organization.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-5" onSubmit={save}>
                <fieldset disabled={loading || saving} className="flex flex-col gap-5">
                  <div className="grid gap-1.5">
                    <Label htmlFor="emailTo">Email recipient</Label>
                    <Input
                      id="emailTo"
                      type="email"
                      placeholder="alerts@example.com"
                      value={form.emailTo}
                      onChange={(event) => update('emailTo', event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="webhookUrl">Webhook URL</Label>
                    <Input
                      id="webhookUrl"
                      type="url"
                      placeholder="https://example.com/hooks/usage"
                      value={form.webhookUrl}
                      onChange={(event) => update('webhookUrl', event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="frequency">Usage summary frequency</Label>
                    <Select
                      value={form.usageSummaryFrequency}
                      onValueChange={(value) =>
                        update('usageSummaryFrequency', value as 'weekly' | 'monthly')
                      }
                    >
                      <SelectTrigger id="frequency" className="sm:w-48">
                        <SelectValue>
                          {form.usageSummaryFrequency === 'weekly' ? 'Weekly' : 'Monthly'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <ToggleRow
                      id="usageAlerts"
                      label="Usage alerts (90% / 95% / 100%)"
                      checked={form.usageAlertsEnabled}
                      onChange={(v) => update('usageAlertsEnabled', v)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Fires as page usage crosses 90%, 95%, and 100% of the plan limit. Trial and
                      renewal reminders are always sent.
                    </p>
                  </div>

                  <div>
                    <Button type="submit" disabled={saving || loading}>
                      {saving ? 'Saving…' : 'Save settings'}
                    </Button>
                  </div>
                </fieldset>
              </form>
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </>
  )
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}
