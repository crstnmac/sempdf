import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { SiteHeader } from "#/components/site-header.tsx";
import {
  PageContainer,
  StateNotice,
  StatusBadge,
  Toolbar,
  UsageMeter,
} from "#/components/page-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { useAsync } from "#/hooks/use-async.ts";
import {
  type AdminOrganizationMember,
  type DashboardTenant,
  type LicenseServiceFilter,
  type TenantStatus,
  api,
  formatDate,
  formatLimit,
  formatNumber,
  relativeDays,
} from "#/lib/api.ts";

export const Route = createFileRoute("/_admin/customers/$id")({
  component: CustomerDetailPage,
});

function CustomerDetailPage() {
  const { id } = Route.useParams();
  const { data, loading, error, refetch } = useAsync(
    () => api.organization(id),
    [id],
  );
  const primaryContact =
    data?.members.find((member) => member.role === "owner") ??
    data?.members.find((member) => member.role === "admin") ??
    data?.members[0] ??
    null;

  return (
    <>
      <SiteHeader title="Customer Details" />
      <PageContainer>
        <Button
          render={<Link to="/customers" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Customers
        </Button>
        {loading && !data ? (
          <StateNotice
            title="Loading customer…"
            message="Fetching the customer profile, members, and licenses."
          />
        ) : error ? (
          <StateNotice
            title="Customer Unavailable"
            message={error}
            tone="warning"
            onRetry={refetch}
          />
        ) : data ? (
          <>
            <section
              aria-labelledby="customer-name"
              className="border-b pb-6"
            >
              <div className="flex min-w-0 items-start gap-4">
                {data.logo ? (
                  <img
                    src={data.logo}
                    alt=""
                    width={48}
                    height={48}
                    fetchPriority="high"
                    className="size-12 shrink-0 rounded-lg border bg-card object-contain"
                  />
                ) : null}
                <div className="min-w-0">
                  <h2
                    id="customer-name"
                    className="text-pretty break-words font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
                  >
                    {data.name}
                  </h2>
                  <p
                    translate="no"
                    className="mt-1 break-all font-mono text-xs text-muted-foreground"
                  >
                    {data.slug}
                  </p>
                </div>
              </div>

              <dl className="mt-6 grid gap-x-8 gap-y-4 border-t pt-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">
                    Primary contact
                  </dt>
                  <dd className="mt-1 min-w-0 text-sm">
                    {primaryContact ? (
                      <>
                        <div className="truncate font-medium">
                          {primaryContact.name}
                        </div>
                        <a
                          href={`mailto:${primaryContact.email}`}
                          className="block truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {primaryContact.email}
                        </a>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        No account owner
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Members
                  </dt>
                  <dd className="mt-1 text-sm font-medium tabular-nums">
                    {formatNumber(data.members.length)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Licenses
                  </dt>
                  <dd className="mt-1 text-sm font-medium tabular-nums">
                    {formatNumber(data.licenses.length)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Customer since
                  </dt>
                  <dd className="mt-1 text-sm font-medium">
                    {formatDate(data.createdAt)}
                  </dd>
                </div>
              </dl>
            </section>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <LicensesCard licenses={data.licenses} />
              <MembersCard members={data.members} />
            </div>
          </>
        ) : null}
      </PageContainer>
    </>
  );
}

function LicensesCard({ licenses }: { licenses: DashboardTenant[] }) {
  const [status, setStatus] = useState<TenantStatus | "all">("all");
  const [service, setService] = useState<LicenseServiceFilter>("all");
  const totalUsed = licenses.reduce(
    (sum, license) => sum + license.usedUnits,
    0,
  );
  const filteredLicenses = useMemo(
    () =>
      licenses.filter(
        (license) =>
          (status === "all" || license.status === status) &&
          (service === "all" ||
            (service === "active" ? license.active : !license.active)),
      ),
    [licenses, status, service],
  );
  const hasFilters = status !== "all" || service !== "all";

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>
          <h3>Licenses</h3>
        </CardTitle>
        <CardDescription>
          {licenses.length
            ? `${formatNumber(totalUsed)} pages used across ${licenses.length} ${licenses.length === 1 ? "license" : "licenses"}.`
            : "No licenses have been issued to this customer."}
        </CardDescription>
      </CardHeader>
      {licenses.length > 1 ? (
        <div className="border-b p-3">
          <Toolbar>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus((value as TenantStatus | "all" | null) ?? "all")
              }
            >
              <SelectTrigger
                className="sm:w-40"
                aria-label="Filter customer licenses by billing status"
              >
                <SelectValue>
                  {status === "all"
                    ? "All billing statuses"
                    : status === "none"
                      ? "Paid"
                      : status === "trial"
                        ? "Trial"
                        : "Hard blocked"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All billing statuses</SelectItem>
                <SelectItem value="none">Paid</SelectItem>
                <SelectItem value="trial">Trial</SelectItem>
                <SelectItem value="hard_blocked">Hard blocked</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={service}
              onValueChange={(value) =>
                setService((value as LicenseServiceFilter | null) ?? "all")
              }
            >
              <SelectTrigger
                className="sm:w-40"
                aria-label="Filter customer licenses by service state"
              >
                <SelectValue>
                  {service === "all"
                    ? "All service states"
                    : service === "active"
                      ? "Service active"
                      : "Revoked"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All service states</SelectItem>
                <SelectItem value="active">Service active</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatus("all");
                  setService("all");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </Toolbar>
        </div>
      ) : null}
      <CardContent className="p-0">
        {licenses.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>License</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-52">Usage</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Keys</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLicenses.map((license) => (
                <TableRow key={license.id}>
                  <TableCell>
                    <Link
                      to="/licenses/$id"
                      params={{ id: license.id }}
                      className="font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {license.keyPrefix === "—"
                        ? "View license"
                        : (
                            <span translate="no">{license.keyPrefix}…</span>
                          )}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Created {formatDate(license.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={license.status} />
                    {!license.active ? (
                      <div className="mt-1 text-xs font-medium text-destructive">
                        Revoked
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <UsageMeter
                      used={license.usedUnits}
                      limit={license.limitUnits}
                    />
                  </TableCell>
                  <TableCell>{licenseTerm(license)}</TableCell>
                  <TableCell>
                    <div className="tabular-nums">
                      {formatNumber(license.keyCount)} active
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredLicenses.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No licenses match the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        ) : (
          <div className="px-5 py-10">
            <p className="font-medium">No Licenses</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Issue a license when this customer is ready to use the service.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MembersCard({
  members,
}: { members: AdminOrganizationMember[] }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>
          <h3>People</h3>
        </CardTitle>
        <CardDescription>
          Members with access to this account.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {members.length ? (
          <ul className="divide-y">
            {members.map((member) => (
              <li key={member.id} className="min-w-0 px-4 py-3.5">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <p className="truncate font-medium">{member.name}</p>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">
                    {member.role}
                  </span>
                </div>
                <a
                  href={`mailto:${member.email}`}
                  className="mt-1 block truncate text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {member.email}
                </a>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Joined {formatDate(member.createdAt)} ·{" "}
                  <span
                    className={
                      member.emailVerified
                        ? undefined
                        : "font-medium text-foreground"
                    }
                  >
                    {member.emailVerified
                      ? "Email verified"
                      : "Email not verified"}
                  </span>
                  {member.banned ? (
                    <span className="font-medium text-destructive">
                      {" "}
                      · Suspended
                    </span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-10">
            <p className="font-medium">No Members</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No one currently has access to this customer account.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function licenseTerm(license: DashboardTenant) {
  if (license.status === "trial") {
    return license.trialEndsAt ? (
      <div>
        <div>{formatDate(license.trialEndsAt)}</div>
        <div className="text-xs text-muted-foreground">
          Trial · {relativeDays(license.trialEndsAt)}
        </div>
      </div>
    ) : (
      <span className="text-muted-foreground">No end date</span>
    );
  }

  if (license.window === "lifetime") {
    return (
      <div>
        <div>Lifetime</div>
        <div className="text-xs text-muted-foreground">
          {formatLimit(license.limitUnits)} pages
        </div>
      </div>
    );
  }

  return license.expiresAt ? (
    <div>
      <div>{formatDate(license.expiresAt)}</div>
      <div className="text-xs text-muted-foreground">
        Renews · {relativeDays(license.expiresAt)}
      </div>
    </div>
  ) : (
    <span className="text-muted-foreground">No renewal date</span>
  );
}
