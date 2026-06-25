import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { AppSidebar } from '#/components/app-sidebar.tsx'
import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar.tsx'
import { authClient, useSession } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/_admin')({
  beforeLoad: async ({ location }) => {
    const { data } = await authClient.getSession()
    if (!data) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    // Only SaaS maintainers (superadmin) may see the operator portal; everyone
    // else is an organization user and goes to the org portal.
    if (data.user.role !== 'superadmin') {
      throw redirect({ to: '/portal' })
    }
  },
  component: AdminLayout,
})

function AdminLayout() {
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
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <AppSidebar user={session.user} onSignOut={handleSignOut} />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
