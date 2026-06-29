import * as React from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import {
  BellIcon,
  BuildingIcon,
  GaugeIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UserCircleIcon,
  UsersIcon,
} from 'lucide-react'

import { Logo } from '#/components/logo.tsx'
import { NavUser } from '#/components/nav-user.tsx'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '#/components/ui/sidebar.tsx'
import { cn } from '#/lib/utils.ts'
import type { SessionUser } from '#/lib/auth-client.ts'

type NavItem = { title: string; to: LinkProps['to']; icon: LucideIcon }
type SidebarConfig = { label: string; home: LinkProps['to']; nav: NavItem[] }

const ADMIN_NAV: NavItem[] = [
  { title: 'Dashboard', to: '/', icon: LayoutDashboardIcon },
  { title: 'Customers', to: '/customers', icon: BuildingIcon },
  { title: 'Licenses', to: '/licenses', icon: KeyRoundIcon },
  { title: 'Usage & telemetry', to: '/usage', icon: GaugeIcon },
]

const PORTAL_NAV: NavItem[] = [
  { title: 'Overview', to: '/portal', icon: BuildingIcon },
  { title: 'Activity', to: '/portal/activity', icon: GaugeIcon },
  { title: 'Members', to: '/portal/members', icon: UsersIcon },
  { title: 'Notifications', to: '/portal/notifications', icon: BellIcon },
  { title: 'Settings', to: '/portal/settings', icon: SettingsIcon },
  { title: 'Account', to: '/portal/account', icon: UserCircleIcon },
]

const VARIANTS: Record<'admin' | 'portal', SidebarConfig> = {
  admin: { label: 'License Ops', home: '/', nav: ADMIN_NAV },
  portal: { label: 'Organization', home: '/portal', nav: PORTAL_NAV },
}

export function AppSidebar({
  user,
  onSignOut,
  audience = 'admin',
  organizationName,
  headerSlot,
  className,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: SessionUser
  onSignOut: () => void
  audience?: 'admin' | 'portal'
  organizationName?: string
  headerSlot?: React.ReactNode
}) {
  const config = VARIANTS[audience]
  const shellName = organizationName?.trim() || config.label
  const { isMobile, setOpenMobile } = useSidebar()
  const navigationLabel = `${config.label} navigation`

  function handleNavigate() {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar
      {...props}
      aria-label={navigationLabel}
      collapsible="icon"
      variant="sidebar"
      className={cn('border-sidebar-border/80', className)}
    >
      <SidebarHeader className="h-(--header-height) shrink-0 flex-row items-center gap-2 border-b border-sidebar-border p-2 group-data-[collapsible=icon]:justify-center">
        <Link
          to={config.home}
          aria-label={`A11yDocs ${shellName} home`}
          onClick={handleNavigate}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring motion-reduce:transition-none"
        >
          <Logo
            markOnly
            className="size-6 shrink-0"
            title=""
          />
        </Link>
        {headerSlot ? (
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">{headerSlot}</div>
        ) : (
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-semibold text-sidebar-foreground">
              {shellName}
            </span>
            <span className="block truncate text-xs text-sidebar-foreground/60">A11yDocs</span>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-2">
          <SidebarGroupContent>
            <nav aria-label={navigationLabel}>
              <SidebarMenu className="gap-1">
                {config.nav.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      tooltip={item.title}
                      className="rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                      render={
                        <Link
                          to={item.to}
                          onClick={handleNavigate}
                          activeOptions={{ exact: item.to === config.home }}
                          activeProps={{
                            'data-active': 'true',
                            'aria-current': 'page',
                          }}
                        />
                      }
                    >
                      <item.icon aria-hidden="true" />
                      <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/70 p-2">
        <NavUser user={user} onSignOut={onSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
