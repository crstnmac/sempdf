/**
 * Typed client for the operator endpoints under `/v1/admin` (see
 * apps/api/src/routes/admin.ts). Every call rides the better-auth session
 * cookie (`credentials: 'include'`); a 401 means "not signed in as admin".
 */

export type TenantStatus = 'none' | 'trial' | 'hard_blocked'
export type TelemetryStatus = 'success' | 'fail' | 'watermarked' | 'blocked'
export type UsageWindow = 'year' | 'lifetime'

/**
 * True when a limit represents an effectively unlimited (∞) plan. Kept as a
 * defensive display helper for any legacy license carrying a very large limit;
 * the Unlimited tier is no longer offered when creating/changing plans.
 */
export function isUnlimited(limit: number): boolean {
  return limit >= 1e15
}

/** Formats a page limit, rendering a very large/unlimited value as ∞. */
export function formatLimit(limit: number): string {
  return isUnlimited(limit) ? '∞' : formatNumber(limit)
}

/**
 * Annual page-volume plan tiers. A tier's `limit` is the enforced annual page
 * allowance (`limitUnits`) = the tier ceiling. `limit: null` is the Custom tier
 * (operator types an exact number).
 */
export const ANNUAL_TIERS: { label: string; limit: number | null }[] = [
  { label: '0 – 50,000', limit: 50_000 },
  { label: '50,000 – 250,000', limit: 250_000 },
  { label: '250,001 – 1,000,000', limit: 1_000_000 },
  { label: '1,000,001 – 5,000,000', limit: 5_000_000 },
  { label: '5,000,001 – 20,000,000', limit: 20_000_000 },
  { label: 'Custom', limit: null },
]

export interface DashboardTenant {
  id: string
  accountId: string
  organizationName: string
  keyPrefix: string
  metric: string
  window: UsageWindow
  limitUnits: number
  usedUnits: number
  remainingUnits: number
  status: TenantStatus
  active: boolean
  firstOverageAt: string | null
  trialStartedAt: string | null
  trialEndsAt: string | null
  expiresAt: string | null
  createdAt: string
}

export interface TelemetryMeta {
  libVersion: string | null
  nodeVersion: string | null
  platform: string | null
  tagged: boolean | null
  language: string | null
  conformance: string | null
  errorCode: string | null
}

export interface TelemetryRow extends TelemetryMeta {
  id: number
  accountId: string
  organizationName: string
  licenseId: string
  endpoint: string
  pages: number
  status: TelemetryStatus
  jobId: string | null
  jobDescription: string | null
  createdAt: string
}

export interface TelemetrySummary {
  totalPages: number
  errorCount: number
  watermarkedCount: number
  uniqueOrgs: number
}

export interface TelemetryPage {
  rows: TelemetryRow[]
  total: number
  page: number
  pageSize: number
  summary: TelemetrySummary
}

export interface NotificationSettings {
  accountId: string
  emailTo: string | null
  webhookUrl: string | null
  usageSummaryFrequency: 'weekly' | 'monthly'
  usageAlertsEnabled: boolean
  overageAlertsEnabled: boolean
  hardBlockWarningsEnabled: boolean
  updatedAt?: string
}

export interface DashboardSummary {
  totalTenants: number
  pagesUsed: number
  hardBlockedTenants: number
  trialTenants: number
}

export interface DashboardData {
  generatedAt: string
  summary: DashboardSummary
  tenants: DashboardTenant[]
  telemetry: TelemetryRow[]
}

export interface LicenseUsage {
  id: string
  accountId: string
  organizationName: string
  metric: string
  window: UsageWindow
  limit: number
  baseLimit: number
  used: number
  remaining: number
  status: TenantStatus
  firstOverageAt: string | null
  trialEndsAt: string | null
  windowStartedAt: string | null
  expiresAt: string | null
  keyCount: number
  active: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function fetchJson<T>(url: string, unauthorizedMessage: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (res.status === 401) {
    throw new ApiError(unauthorizedMessage, 401)
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.error ?? ''
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail || `Request failed with HTTP ${res.status}.`, res.status)
  }
  return res.json() as Promise<T>
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetchJson<T>(
    `/v1/admin${path}`,
    'Sign in with an admin account to view license operations.',
    init,
  )
}

function portalRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return fetchJson<T>(`/v1/portal${path}`, 'Sign in to view your organization.', init)
}

export interface AdminOrganization {
  id: string
  name: string
  slug: string
  ownerEmail: string | null
  ownerName: string | null
  memberCount: number
  licenseCount: number
  trialCount: number
  activeCount: number
  blockedCount: number
  createdAt: string
}

export interface LicensePage {
  rows: DashboardTenant[]
  total: number
  page: number
  pageSize: number
}

export interface OrganizationPage {
  rows: AdminOrganization[]
  total: number
  page: number
  pageSize: number
}

export const api = {
  dashboard: () => request<DashboardData>('/dashboard'),
  licenses: (params: { page?: number; pageSize?: number; q?: string; status?: TenantStatus | 'all' } = {}) => {
    const sp = new URLSearchParams()
    if (params.page) sp.set('page', String(params.page))
    if (params.pageSize) sp.set('pageSize', String(params.pageSize))
    if (params.q) sp.set('q', params.q)
    if (params.status && params.status !== 'all') sp.set('status', params.status)
    const qs = sp.toString()
    return request<LicensePage>(`/licenses${qs ? `?${qs}` : ''}`)
  },
  organizations: (params: { page?: number; pageSize?: number; q?: string } = {}) => {
    const sp = new URLSearchParams()
    if (params.page) sp.set('page', String(params.page))
    if (params.pageSize) sp.set('pageSize', String(params.pageSize))
    if (params.q) sp.set('q', params.q)
    const qs = sp.toString()
    return request<OrganizationPage>(`/organizations${qs ? `?${qs}` : ''}`)
  },
  telemetry: (params: {
    page?: number; pageSize?: number; from?: string; to?: string;
    status?: string; q?: string;
  } = {}) => {
    const sp = new URLSearchParams()
    if (params.page) sp.set('page', String(params.page))
    if (params.pageSize) sp.set('pageSize', String(params.pageSize))
    if (params.from) sp.set('from', params.from)
    if (params.to) sp.set('to', params.to)
    if (params.status) sp.set('status', params.status)
    if (params.q) sp.set('q', params.q)
    const qs = sp.toString()
    return request<TelemetryPage>(`/telemetry${qs ? `?${qs}` : ''}`)
  },
  licenseUsage: (id: string) => request<LicenseUsage>(`/licenses/${id}/usage`),
  licenseTelemetry: (id: string, params: { page?: number; pageSize?: number } = {}) => {
    const sp = new URLSearchParams()
    if (params.page) sp.set('page', String(params.page))
    if (params.pageSize) sp.set('pageSize', String(params.pageSize))
    const qs = sp.toString()
    return request<{ rows: TelemetryRow[]; total: number; page: number; pageSize: number }>(
      `/licenses/${id}/telemetry${qs ? `?${qs}` : ''}`,
    )
  },
  extendTrial: (id: string, body: { days?: number; trialEndsAt?: string }) =>
    request<{ id: string; trialEndsAt: string | null; status: TenantStatus }>(
      `/licenses/${id}/extend-trial`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  addPages: (id: string, pages: number, recurring: boolean) =>
    request<{ id: string; limitUnits: number; usedUnits: number; status: TenantStatus; recurring: boolean }>(
      `/licenses/${id}/add-pages`,
      { method: 'POST', body: JSON.stringify({ pages, recurring }) },
    ),
  changePlan: (
    id: string,
    body: {
      limit: number
      window: UsageWindow
      startsAt?: string | null
      expiresAt?: string | null
      convertToPaid?: boolean
    },
  ) =>
    request<{
      id: string
      status: TenantStatus
      window: UsageWindow
      limitUnits: number
      usedUnits: number
      windowStartedAt: string | null
      expiresAt: string | null
    }>(`/licenses/${id}/plan`, { method: 'POST', body: JSON.stringify(body) }),
  rotateKey: (id: string) =>
    request<{ id: string; keyPrefix: string; key: string; revokedCount: number }>(
      `/licenses/${id}/rotate`,
      { method: 'POST' },
    ),
  revoke: (id: string) =>
    request<{ ok: boolean }>(`/licenses/${id}/revoke`, { method: 'POST' }),
  reactivate: (id: string) =>
    request<{ ok: boolean; active: boolean; status: TenantStatus }>(
      `/licenses/${id}/reactivate`,
      { method: 'POST' },
    ),
  createLicense: (body: Record<string, unknown>) =>
    request<DashboardTenant & { key: string }>('/licenses', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createCustomer: (body: {
    orgName: string
    customerName: string
    customerEmail: string
    kind: 'trial' | 'paid'
    limit: number
    window: UsageWindow
    trialEndsAt?: string
    startsAt?: string
    expiresAt?: string
  }) =>
    request<{
      organization: { id: string; name: string; slug: string }
      customerEmail: string
      temporaryPassword: string
      license: { id: string; status: TenantStatus; limitUnits: number; trialEndsAt: string | null; expiresAt: string | null }
      keyPrefix: string
      key: string
    }>('/customers', { method: 'POST', body: JSON.stringify(body) }),
}

// ----- customer portal (own organizations only) -----------------------------

export interface PortalOrganization {
  id: string
  name: string
  slug: string
  role: string
}

export interface PortalApiKey {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  createdAt: string
}

export interface RevokedApiKey extends PortalApiKey {
  revokedAt: string
}

export interface PortalLicense {
  id: string
  accountId: string
  organizationName: string
  metric: string
  window: UsageWindow
  limitUnits: number
  usedUnits: number
  remainingUnits: number
  status: TenantStatus
  active: boolean
  trialEndsAt: string | null
  resetAt: string | null
  createdAt: string
  keys: PortalApiKey[]
  revokedKeys: RevokedApiKey[]
}

export interface PortalTelemetry extends TelemetryMeta {
  id: number
  accountId: string
  organizationName: string
  licenseId: string
  endpoint: string
  pages: number
  status: TelemetryStatus
  jobId: string | null
  jobDescription: string | null
  createdAt: string
}

export interface PortalOverview {
  organizations: PortalOrganization[]
  licenses: PortalLicense[]
  telemetry: PortalTelemetry[]
  summary: { pagesUsed: number; pageLimit: number; activeLicenses: number }
}

export interface PortalMember {
  id: string
  userId: string
  name: string
  email: string
  role: string
  isSelf: boolean
  createdAt: string
}

export interface PortalInvitation {
  id: string
  email: string
  role: string | null
  status: string
  expiresAt: string
}

export interface PortalMembers {
  members: PortalMember[]
  invitations: PortalInvitation[]
}

export interface PortalActivityRow {
  id: number
  organizationName: string
  endpoint: string
  pages: number
  status: TelemetryStatus
  jobId: string | null
  jobDescription: string | null
  errorCode: string | null
  createdAt: string
}

export interface PortalActivityPage {
  rows: PortalActivityRow[]
  total: number
  page: number
  pageSize: number
}

export const portalApi = {
  overview: () => portalRequest<PortalOverview>('/overview'),
  usageSeries: (days = 30) =>
    portalRequest<{ days: number; series: { date: string; pages: number }[] }>(
      `/usage-series?days=${days}`,
    ),
  activity: (params: { page?: number; pageSize?: number; status?: TelemetryStatus | 'all' } = {}) => {
    const sp = new URLSearchParams()
    if (params.page) sp.set('page', String(params.page))
    if (params.pageSize) sp.set('pageSize', String(params.pageSize))
    if (params.status && params.status !== 'all') sp.set('status', params.status)
    const qs = sp.toString()
    return portalRequest<PortalActivityPage>(`/activity${qs ? `?${qs}` : ''}`)
  },
  members: (orgId: string) => portalRequest<PortalMembers>(`/orgs/${orgId}/members`),
  invite: (orgId: string, body: { email: string; role: string }) =>
    portalRequest<PortalInvitation>(`/orgs/${orgId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelInvite: (orgId: string, invId: string) =>
    portalRequest<{ ok: boolean }>(`/orgs/${orgId}/invitations/${invId}`, { method: 'DELETE' }),
  updateMemberRole: (orgId: string, memberId: string, role: string) =>
    portalRequest<PortalMember>(`/orgs/${orgId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeMember: (orgId: string, memberId: string) =>
    portalRequest<{ ok: boolean }>(`/orgs/${orgId}/members/${memberId}`, { method: 'DELETE' }),
  updateOrg: (orgId: string, body: { name?: string; slug?: string; logo?: string | null }) =>
    portalRequest<{ id: string; name: string; slug: string; logo: string | null }>(`/orgs/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  notificationSettings: (orgId: string) =>
    portalRequest<NotificationSettings>(`/orgs/${orgId}/notification-settings`),
  saveNotificationSettings: (orgId: string, body: Partial<NotificationSettings>) =>
    portalRequest<NotificationSettings>(`/orgs/${orgId}/notification-settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  createKey: (licenseId: string, name: string) =>
    portalRequest<{ id: string; name: string; keyPrefix: string; key: string }>(
      `/licenses/${licenseId}/keys`,
      { method: 'POST', body: JSON.stringify({ name }) },
    ),
  revokeKey: (keyId: string) =>
    portalRequest<{ ok: boolean }>(`/keys/${keyId}`, { method: 'DELETE' }),
  rotateApiKey: (keyId: string) =>
    portalRequest<{ id: string; name: string; keyPrefix: string; key: string }>(
      `/keys/${keyId}/rotate`,
      { method: 'POST' },
    ),
}

// ----- presentation helpers -------------------------------------------------

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

/**
 * Human label for an activity row, describing what happened to the generation
 * (not the internal endpoint). Pairs with the status badge.
 */
export function activityLabel(status: TelemetryStatus): string {
  switch (status) {
    case 'blocked':
      return 'Generation blocked'
    case 'fail':
      return 'Generation failed'
    case 'watermarked':
      return 'PDF generated (watermarked)'
    default:
      return 'PDF generated'
  }
}

const STATUS_LABELS: Record<TenantStatus, string> = {
  none: 'Active',
  trial: 'Trial',
  hard_blocked: 'Hard blocked',
}

export function statusLabel(status: TenantStatus): string {
  return STATUS_LABELS[status] ?? status
}

export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline'

export function statusTone(status: TenantStatus): BadgeTone {
  switch (status) {
    case 'hard_blocked':
      return 'destructive'
    case 'trial':
      return 'secondary'
    default:
      return 'default'
  }
}

export function telemetryTone(status: TelemetryStatus): BadgeTone {
  switch (status) {
    case 'blocked':
    case 'fail':
      return 'destructive'
    case 'watermarked':
      return 'outline'
    default:
      return 'secondary'
  }
}

/** Usage as a 0–100 percentage; lifetime/zero limits clamp sensibly. */
export function usagePercent(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? 100 : 0
  return Math.min(100, Math.round((used / limit) * 100))
}

/**
 * The visible watermark a generated PDF gets under the current status — mirrors
 * the server's enforcement: trials watermark every run with
 * "ZeroPDF - For Trial Use Only". Null means clean output.
 */
export function watermarkLabel(status: TenantStatus): string | null {
  if (status === 'trial') return 'ZeroPDF - For Trial Use Only'
  return null
}

/** Whole days from now until `iso` (negative if past). Null when no date. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

/** Human countdown like "in 5 days" / "today" / "3 days ago". */
export function relativeDays(iso: string | null | undefined): string {
  const days = daysUntil(iso)
  if (days === null) return '—'
  if (days === 0) return 'today'
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`
  const past = Math.abs(days)
  return `${past} day${past === 1 ? '' : 's'} ago`
}
