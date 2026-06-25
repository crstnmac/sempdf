import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Trash2Icon } from 'lucide-react'

import { SiteHeader } from '#/components/site-header.tsx'
import { PageContainer, StateNotice } from '#/components/page-shell.tsx'
import { Badge } from '#/components/ui/badge.tsx'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table.tsx'
import { useAsync } from '#/hooks/use-async.ts'
import { ApiError, formatDate, portalApi } from '#/lib/api.ts'
import { useActiveOrg } from '#/lib/portal-org.tsx'

export const Route = createFileRoute('/portal/members')({ component: MembersPage })

const ROLES = ['member', 'admin', 'owner']

function MembersPage() {
  const { activeOrg, activeOrgId } = useActiveOrg()
  const orgId = activeOrgId ?? ''
  const { data, loading, error, refetch } = useAsync(() => portalApi.members(orgId), [orgId])

  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)

  async function act<T>(fn: () => Promise<T>) {
    setBusy(true)
    try {
      await fn()
      refetch()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    await act(async () => {
      await portalApi.invite(orgId, { email: email.trim(), role })
      setEmail('')
      setRole('member')
      toast.success('Invitation created.')
    })
  }

  return (
    <>
      <SiteHeader
        title="Members"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice title="Loading members" message="Fetching your organization's members." />
        ) : error ? (
          <StateNotice title="Unavailable" message={error} tone="warning" onRetry={refetch} />
        ) : data ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Invite a teammate</CardTitle>
                <CardDescription>
                  Invite people to {activeOrg?.name ?? 'your organization'} by email.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={invite}>
                  <div className="grid flex-1 gap-1.5">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      placeholder="teammate@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="invite-role">Role</Label>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger id="invite-role" className="sm:w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="capitalize">
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={busy}>
                    Invite
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <CardDescription>{data.members.length} member(s)</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Remove</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.members.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">
                          {m.name}
                          {m.isSelf ? (
                            <span className="ml-2 text-xs text-muted-foreground">you</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{m.email}</TableCell>
                        <TableCell>
                          <Select
                            value={m.role}
                            onValueChange={(value) =>
                              act(async () => {
                                await portalApi.updateMemberRole(orgId, m.id, value)
                                toast.success('Role updated.')
                              })
                            }
                          >
                            <SelectTrigger className="w-32 capitalize">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map((r) => (
                                <SelectItem key={r} value={r} className="capitalize">
                                  {r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy || m.isSelf}
                            onClick={() =>
                              act(async () => {
                                await portalApi.removeMember(orgId, m.id)
                                toast.success('Member removed.')
                              })
                            }
                          >
                            <Trash2Icon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {data.invitations.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Pending invitations</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead className="text-right">Cancel</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.invitations.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.email}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">
                              {inv.role ?? 'member'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(inv.expiresAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              onClick={() =>
                                act(async () => {
                                  await portalApi.cancelInvite(orgId, inv.id)
                                  toast.success('Invitation cancelled.')
                                })
                              }
                            >
                              <Trash2Icon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </PageContainer>
    </>
  )
}
