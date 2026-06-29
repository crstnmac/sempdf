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
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react'

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
type SidebarConfig = { title: string; home: LinkProps['to']; nav: NavItem[] }

const ADMIN_NAV: NavItem[] = [
  { title: 'Dashboard', to: '/', icon: LayoutDashboardIcon },
  { title: 'Licenses', to: '/licenses', icon: KeyRoundIcon },
  { title: 'Usage & telemetry', to: '/usage', icon: GaugeIcon },
]

const PORTAL_NAV: NavItem[] = [
  { title: 'Overview', to: '/portal', icon: BuildingIcon },
  { title: 'Members', to: '/portal/members', icon: UsersIcon },
  { title: 'Notifications', to: '/portal/notifications', icon: BellIcon },
  { title: 'Settings', to: '/portal/settings', icon: SettingsIcon },
]

const VARIANTS: Record<'admin' | 'portal', SidebarConfig> = {
  admin: { title: 'ZeroPDF License Ops', home: '/', nav: ADMIN_NAV },
  portal: { title: 'Organization Admin', home: '/portal', nav: PORTAL_NAV },
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to={config.home} />} className="data-[slot=sidebar-menu-button]:p-1.5!">
              <ShieldCheckIcon className="size-5!" />
              <span className="text-base font-semibold">{config.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
