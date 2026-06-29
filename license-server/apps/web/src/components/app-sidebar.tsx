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
} from '#/components/ui/sidebar.tsx'
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
  headerSlot,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: SessionUser
  onSignOut: () => void
  audience?: 'admin' | 'portal'
  headerSlot?: React.ReactNode
}) {
  const config = VARIANTS[audience]
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <Link
          to={config.home}
          className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-sidebar-accent"
        >
          <Logo className="h-6 w-auto shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">{config.label}</span>
        </Link>
        {headerSlot ? <div className="px-1 pt-1">{headerSlot}</div> : null}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {config.nav.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={
                      <Link
                        to={item.to}
                        activeOptions={{ exact: item.to === config.home }}
                        activeProps={{ 'data-active': 'true' }}
                      />
                    }
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onSignOut={onSignOut} />
      </SidebarFooter>
    </Sidebar>
  )
}
