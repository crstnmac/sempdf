import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { AppSidebar } from '#/components/app-sidebar.tsx'
import { OrgSwitcher } from '#/components/org-switcher.tsx'
import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar.tsx'
import { ActiveOrgProvider, useActiveOrg } from '#/lib/portal-org.tsx'
import { authClient, useSession, type SessionUser } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/portal')({
  beforeLoad: async ({ location }) => {
    const { data, error } = await authClient.getSession()
    // Only a real "no session" response (no data, no error — better-auth
    // returns 200 + null for this) means genuinely logged out. Any other
    // error (429 rate-limited, 5xx, network blip) must NOT redirect to
    // login: that would sign out a perfectly valid session over a transient
    // failure.
    if (!data && !error) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: PortalLayout,
})

function PortalLayout() {
  const navigate = useNavigate()
  const { data: session, isPending } = useSession()

  async function handleSignOut() {
    await authClient.signOut()
    navigate({ to: '/login' })
  }

  if (isPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading workspace…
      </div>
    )
  }

  return (
    <ActiveOrgProvider>
      <PortalShell user={session.user} onSignOut={handleSignOut} />
    </ActiveOrgProvider>
  )
}

/**
 * Portal chrome, rendered inside ActiveOrgProvider so it can read the caller's
 * admin status. Members (no admin org) keep the portal — Overview/Activity/
 * Account — but admin-only nav is hidden; the admin pages gate themselves with
 * RequireOrgAdmin for anyone who reaches them by URL.
 */
function PortalShell({
  user,
  onSignOut,
}: {
  user: SessionUser
  onSignOut: () => void
}) {
  const { noAdminAccess } = useActiveOrg()
  return (
    <SidebarProvider
      style={
        {
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <AppSidebar
        audience="portal"
        user={user}
        onSignOut={onSignOut}
        canAdmin={!noAdminAccess}
        headerSlot={<OrgSwitcher />}
      />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
