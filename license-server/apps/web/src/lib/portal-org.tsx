import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { type PortalOrganization, portalApi } from '#/lib/api.ts'

const ADMIN_ROLES = new Set(['owner', 'admin'])
const STORAGE_KEY = 'portal.activeOrgId'

interface ActiveOrgValue {
  /** Organizations where the user is owner/admin (can administer). */
  orgs: PortalOrganization[]
  activeOrg: PortalOrganization | null
  activeOrgId: string | null
  setActiveOrgId: (id: string) => void
  loading: boolean
  error: string | null
  /** True once loaded if the user administers no organization. */
  noAdminAccess: boolean
}

const ActiveOrgContext = createContext<ActiveOrgValue | null>(null)

export function ActiveOrgProvider({ children }: { children: React.ReactNode }) {
  const [orgs, setOrgs] = useState<PortalOrganization[]>([])
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    portalApi
      .overview()
      .then((data) => {
        if (cancelled) return
        const adminOrgs = data.organizations.filter((org) => ADMIN_ROLES.has(org.role))
        setOrgs(adminOrgs)
        const stored = localStorage.getItem(STORAGE_KEY)
        const initial =
          (stored && adminOrgs.some((o) => o.id === stored) ? stored : adminOrgs[0]?.id) ?? null
        setActiveOrgIdState(initial)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load organizations.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function setActiveOrgId(id: string) {
    localStorage.setItem(STORAGE_KEY, id)
    setActiveOrgIdState(id)
  }

  const value = useMemo<ActiveOrgValue>(
    () => ({
      orgs,
      activeOrg: orgs.find((o) => o.id === activeOrgId) ?? null,
      activeOrgId,
      setActiveOrgId,
      loading,
      error,
      noAdminAccess: !loading && orgs.length === 0,
    }),
    [orgs, activeOrgId, loading, error],
  )

  return <ActiveOrgContext.Provider value={value}>{children}</ActiveOrgContext.Provider>
}

export function useActiveOrg(): ActiveOrgValue {
  const ctx = useContext(ActiveOrgContext)
  if (!ctx) throw new Error('useActiveOrg must be used within ActiveOrgProvider')
  return ctx
}

/**
 * Gates owner/admin-only portal sections. Org members (no admin role anywhere)
 * get a clear notice instead of a raw `forbidden` from the API. Members still
 * reach Overview, Activity, and Account — only these admin sections are blocked.
 */
export function RequireOrgAdmin({ children }: { children: React.ReactNode }) {
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
          <h2 className="font-heading text-lg font-semibold">Owner or admin access required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This section is only available to organization owners and admins. You can still view
            your organization's usage and activity from the Overview.
          </p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
