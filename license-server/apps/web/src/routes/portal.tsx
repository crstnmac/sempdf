import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { AppSidebar } from '#/components/app-sidebar.tsx'
import { OrgSwitcher } from '#/components/org-switcher.tsx'
import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar.tsx'
import { ActiveOrgProvider, useActiveOrg } from '#/lib/portal-org.tsx'
import { authClient, useSession } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/portal')({
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession()
    if (!data) {
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
      <SidebarProvider
        style={
          {
            '--sidebar-width': 'calc(var(--spacing) * 72)',
            '--header-height': 'calc(var(--spacing) * 12)',
          } as React.CSSProperties
        }
      >
        <AppSidebar
          audience="portal"
          user={session.user}
          onSignOut={handleSignOut}
          headerSlot={<OrgSwitcher />}
        />
        <SidebarInset>
          <AdminGate>
            <Outlet />
          </AdminGate>
        </SidebarInset>
      </SidebarProvider>
    </ActiveOrgProvider>
  )
}

/** Blocks the portal for users who administer no organization (plain members). */
function AdminGate({ children }: { children: React.ReactNode }) {
  const { loading, noAdminAccess } = useActiveOrg()
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading organization…
      </div>
    )
  }
  if (noAdminAccess) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h2 className="font-heading text-lg font-semibold">No admin access</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You are not an owner or admin of any organization. Ask an organization owner to grant
            you access, or create your own organization.
          </p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
