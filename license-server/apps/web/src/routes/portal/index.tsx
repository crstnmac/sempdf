import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CopyIcon,
  PlusIcon,
  RocketIcon,
  RotateCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { SiteHeader } from "#/components/site-header.tsx";
import { useConfirm } from "#/components/confirm.tsx";
import {
  PageContainer,
  StateNotice,
  StatusBadge,
  UsageMeter,
  WatermarkBadge,
} from "#/components/page-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { ScrollFade } from "#/components/ui/scroll-fade.tsx";
import { useAsync } from "#/hooks/use-async.ts";
import {
  ApiError,
  type PortalLicense,
  type TenantStatus,
  formatDate,
  formatNumber,
  portalApi,
  relativeDays,
  statusLabel,
  usagePercent,
} from "#/lib/api.ts";

export const Route = createFileRoute("/portal/")({
  component: PortalOverviewPage,
});

const STATUS_SEVERITY: Record<TenantStatus, number> = {
  hard_blocked: 3,
  trial: 1,
  none: 0,
};

/** Org-level roles allowed to create, rotate, and revoke API keys. */
const isOrgAdmin = (role: string | undefined) =>
  role === "owner" || role === "admin";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  } catch {
    toast.error("Copy failed — select and copy manually.");
  }
}

function PortalOverviewPage() {
  const { data, loading, error, refetch } = useAsync(() =>
    portalApi.overview(),
  );
  const confirm = useConfirm();
  const [issued, setIssued] = useState<{
    licenseId: string;
    key: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Key management (create / rotate / revoke) is owner/admin-only. Map each
  // org id to the caller's role so we can hide actions a plain member can't use
  // instead of letting the buttons fail with a 403.
  const roleByOrg = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of data?.organizations ?? []) map.set(org.id, org.role);
    return map;
  }, [data]);

  // The license that drives the headline: the most over-extended / soonest to
  // matter, falling back to the newest.
  const primary = useMemo(() => {
    const licenses = data?.licenses ?? [];
    return (
      [...licenses].sort(
        (a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status],
      )[0] ?? null
    );
  }, [data]);

  async function createKey(licenseId: string, name: string) {
    setBusyId(licenseId);
    try {
      const { key } = await portalApi.createKey(licenseId, name);
      setIssued({ licenseId, key });
      toast.success("API key created. Copy it now — it is shown once.");
      refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not create key.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function revokeKey(keyId: string, name: string, isLast: boolean) {
    const ok = await confirm({
      title: `Revoke "${name}"?`,
      description: isLast
        ? "This is the last active key on this license. Revoking it stops every app from authorizing until you create a new key."
        : "Any app using this key will stop working immediately. Other keys on this license keep working.",
      confirmLabel: "Revoke key",
      destructive: true,
    });
    if (!ok) return;
    try {
      await portalApi.revokeKey(keyId);
      toast.success("Key revoked.");
      refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not revoke key.",
      );
    }
  }

  async function rotateKey(keyId: string, name: string, licenseId: string) {
    const ok = await confirm({
      title: `Rotate "${name}"?`,
      description:
        "A new secret is issued for this key and the old one stops working immediately. Update your environment with the new value — it is shown only once.",
      confirmLabel: "Rotate key",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(licenseId);
    try {
      const { key } = await portalApi.rotateApiKey(keyId);
      setIssued({ licenseId, key });
      toast.success("Key rotated. Copy it now — it is shown once.");
      refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not rotate key.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const hasLicenses = (data?.licenses.length ?? 0) > 0;

  return (
    <>
      <SiteHeader
        title="Overview"
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            Refresh
          </Button>
        }
      />
      <PageContainer>
        {loading && !data ? (
          <StateNotice
            title="Loading your organization"
            message="Fetching your licenses and usage."
          />
        ) : error ? (
          <StateNotice
            title="Unavailable"
            message={error}
            tone="warning"
            onRetry={refetch}
          />
        ) : data ? (
          !hasLicenses ? (
            <NoLicense />
          ) : (
            <>
              <StatusBanner licenses={data.licenses} />

              {primary ? (
                <UsageSummary summary={data.summary} primary={primary} />
              ) : null}

              <LicensesSection
                licenses={data.licenses}
                roleByOrg={roleByOrg}
                issued={issued}
                busyId={busyId}
                onCreate={createKey}
                onRevoke={revokeKey}
                onRotate={rotateKey}
              />
            </>
          )
        ) : null}
      </PageContainer>
    </>
  );
}

/** Headline block: usage vs limit, remaining/overage, plan status, and what's next. */
function UsageSummary({
  summary,
  primary,
}: {
  summary: { pagesUsed: number; pageLimit: number; activeLicenses: number };
  primary: PortalLicense;
}) {
  const used = summary.pagesUsed;
  const limit = summary.pageLimit;
  const remaining = limit - used;
  const over = remaining < 0;
  const pct = usagePercent(used, limit);

  const nextLabel =
    primary.status === "trial" && primary.trialEndsAt ? "Trial ends" : "Resets";
  const nextValue =
    primary.status === "trial"
      ? primary.trialEndsAt
        ? relativeDays(primary.trialEndsAt)
        : "—"
      : primary.resetAt
        ? relativeDays(primary.resetAt)
        : "Never (lifetime)";
  const nextHint = formatDate(
    primary.status === "trial" ? primary.trialEndsAt : primary.resetAt,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardDescription>Page usage this period</CardDescription>
            <CardTitle className="text-3xl font-semibold tabular-nums">
              {formatNumber(used)}
              <span className="text-lg font-normal text-muted-foreground">
                {" "}
                / {limit > 0 ? formatNumber(limit) : "∞"} pages
              </span>
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <WatermarkBadge status={primary.status} />
            <StatusBadge status={primary.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <UsageMeter used={used} limit={limit} showNumbers={false} />
          <p className="mt-2 text-sm text-muted-foreground">
            {over ? (
              <span className="font-medium text-destructive">
                {formatNumber(-remaining)} pages over the limit
              </span>
            ) : (
              <>
                {formatNumber(remaining)} pages remaining ({pct}% used)
              </>
            )}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
          <MiniStat
            label={over ? "Over limit" : "Remaining"}
            value={
              over
                ? formatNumber(-remaining)
                : limit > 0
                  ? formatNumber(remaining)
                  : "∞"
            }
            tone={over ? "destructive" : undefined}
          />
          <MiniStat label="Plan status" value={statusLabel(primary.status)} />
          <MiniStat label={nextLabel} value={nextValue} hint={nextHint} />
        </div>
      </CardContent>
    </Card>
  );
}

/** A single figure in the hero block's stat strip (hairline-separated cells). */
function MiniStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "destructive";
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-base font-semibold ${tone === "destructive" ? "text-destructive" : ""}`}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function LicensesSection({
  licenses,
  roleByOrg,
  issued,
  busyId,
  onCreate,
  onRevoke,
  onRotate,
}: {
  licenses: PortalLicense[];
  roleByOrg: Map<string, string>;
  issued: { licenseId: string; key: string } | null;
  busyId: string | null;
  onCreate: (licenseId: string, name: string) => void;
  onRevoke: (keyId: string, name: string, isLast: boolean) => void;
  onRotate: (keyId: string, name: string, licenseId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          API keys authenticate the sempdf library. Create one per environment
          (production, staging, CI) — they all share this plan's page quota. Set{" "}
          <code className="rounded bg-muted-surface px-1 py-0.5 text-xs">
            SEMPDF_LICENSE_KEY
          </code>{" "}
          in your environment — the server URL is baked in, so there's nothing
          else to configure.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {licenses.map((lic, i) => (
          <LicenseKeys
            key={lic.id}
            lic={lic}
            canManage={isOrgAdmin(roleByOrg.get(lic.accountId))}
            showName={licenses.length > 1}
            separated={i > 0}
            issuedKey={issued?.licenseId === lic.id ? issued.key : null}
            busy={busyId === lic.id}
            onCreate={onCreate}
            onRevoke={onRevoke}
            onRotate={onRotate}
          />
        ))}
        <QuickStart />
      </CardContent>
    </Card>
  );
}

/** API keys for one license. Usage/status/renewal live in the hero block above,
 *  so this stays focused on key management to avoid duplicating that info. */
function LicenseKeys({
  lic,
  canManage,
  showName,
  separated,
  issuedKey,
  busy,
  onCreate,
  onRevoke,
  onRotate,
}: {
  lic: PortalLicense;
  canManage: boolean;
  showName: boolean;
  separated: boolean;
  issuedKey: string | null;
  busy: boolean;
  onCreate: (licenseId: string, name: string) => void;
  onRevoke: (keyId: string, name: string, isLast: boolean) => void;
  onRotate: (keyId: string, name: string, licenseId: string) => void;
}) {
  return (
    <div className={separated ? "border-t border-border pt-6" : undefined}>
      {showName ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="font-heading text-sm font-semibold text-foreground">
            {lic.organizationName}
          </h3>
          <StatusBadge status={lic.status} />
        </div>
      ) : null}
      <KeysManager
        lic={lic}
        canManage={canManage}
        issuedKey={issuedKey}
        busy={busy}
        onCreate={onCreate}
        onRevoke={onRevoke}
        onRotate={onRotate}
      />
    </div>
  );
}

/** Lists a license's API keys and lets owners/admins create, rotate, or revoke
 *  them. Members see the list read-only (the mutating actions 403 server-side,
 *  so we hide them rather than offer buttons that fail). */
function KeysManager({
  lic,
  canManage,
  issuedKey,
  busy,
  onCreate,
  onRevoke,
  onRotate,
}: {
  lic: PortalLicense;
  canManage: boolean;
  issuedKey: string | null;
  busy: boolean;
  onCreate: (licenseId: string, name: string) => void;
  onRevoke: (keyId: string, name: string, isLast: boolean) => void;
  onRotate: (keyId: string, name: string, licenseId: string) => void;
}) {
  const [name, setName] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onCreate(lic.id, name.trim() || "New key");
    setName("");
  }

  return (
    <div className="flex flex-col gap-3">
      {issuedKey ? <KeyReveal apiKey={issuedKey} /> : null}

      {lic.keys.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {lic.keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{k.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {k.keyPrefix}••••••••
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
                  {k.lastUsedAt
                    ? `Used ${relativeDays(k.lastUsedAt)}`
                    : "Never used"}
                </span>
                {canManage ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!lic.active || busy}
                      onClick={() => onRotate(k.id, k.name, lic.id)}
                    >
                      <RotateCwIcon />
                      Rotate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        onRevoke(k.id, k.name, lic.keys.length === 1)
                      }
                    >
                      <Trash2Icon />
                      Revoke
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "No active keys. Create one to start generating PDFs."
            : "No active keys. Ask an organization owner or admin to create one."}
        </p>
      )}

      {lic.revokedKeys.length > 0 ? (
        <details className="rounded-md border border-border bg-card/50">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
            Revoked keys ({lic.revokedKeys.length})
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {lic.revokedKeys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-muted-foreground line-through">
                    {k.name}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {k.keyPrefix}••••••••
                  </p>
                </div>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  Revoked {relativeDays(k.revokedAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canManage ? (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this key (e.g. production)"
            maxLength={60}
            disabled={!lic.active || busy}
            className="sm:max-w-xs"
          />
          <Button type="submit" size="sm" disabled={!lic.active || busy}>
            <PlusIcon />
            {busy ? "Creating…" : "Create key"}
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Only organization owners and admins can create, rotate, or revoke keys.
        </p>
      )}
    </div>
  );
}

/** One-time reveal shown immediately after a key is (re)generated. */
function KeyReveal({ apiKey }: { apiKey: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
        <CheckCircle2Icon className="size-4" />
        New API key — copy it now
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm break-all">
          {apiKey}
        </code>
        <Button variant="outline" size="sm" onClick={() => copy(apiKey)}>
          <CopyIcon />
          Copy
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-warning">
        <TriangleAlertIcon className="size-3.5" />
        This is the only time the key is shown. It can't be retrieved later —
        store it securely.
      </p>
    </div>
  );
}

/** Collapsible copy-paste integration guide (no secret in the snippet). */
function QuickStart() {
  const snippet = `# .env
SEMPDF_LICENSE_KEY=<your-key>

# app.ts
import { createDocument } from '@barrierbreak/sempdf-pdf'

const doc = createDocument({ title: 'Invoice', language: 'en-US' })
doc.addPage({ size: 'A4' }).text('Hello', { x: 24, y: 700 })
const bytes = doc.toUint8Array() // license is verified automatically`;

  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-medium">
        Quick start — use the key with the library
        <span className="text-xs text-muted-foreground group-open:hidden">
          Show
        </span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">
          Hide
        </span>
      </summary>
      <div className="border-t border-border p-4">
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => copy(snippet)}>
            <CopyIcon />
            Copy
          </Button>
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-card text-xs">
          <ScrollFade orientation="horizontal" className="p-3">
            <pre>
              <code>{snippet}</code>
            </pre>
          </ScrollFade>
        </div>
      </div>
    </details>
  );
}

/** Onboarding shown when the account has no license yet. */
function NoLicense() {
  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RocketIcon className="size-5 text-primary" />
          No license yet
        </CardTitle>
        <CardDescription>
          Your account doesn’t have a license. Contact your account manager to
          set up a trial or plan.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function StatusBanner({ licenses }: { licenses: PortalLicense[] }) {
  if (licenses.some((lic) => !lic.active)) {
    return (
      <Banner tone="danger">
        One or more licenses are <strong>inactive</strong> — every API key is
        suspended and generation is rejected. Contact your account manager to
        restore service.
      </Banner>
    );
  }
  if (licenses.some((lic) => lic.status === "hard_blocked")) {
    return (
      <Banner tone="danger">
        One or more licenses are <strong>hard blocked</strong> — new generation
        runs are rejected. Renew or contact your account manager to restore
        service.
      </Banner>
    );
  }
  const trial = licenses.find((lic) => lic.status === "trial");
  if (trial) {
    return (
      <Banner tone="info">
        Trial active
        {trial.trialEndsAt ? ` — ends ${relativeDays(trial.trialEndsAt)}` : ""}.
        All output PDFs are watermarked{" "}
        <strong>“SemPDF - For Trial Use Only”</strong> until you upgrade.
      </Banner>
    );
  }
  return null;
}

function Banner({
  tone,
  children,
}: {
  tone: "info" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const styles = {
    info: "bg-accent text-accent-foreground",
    warning: "bg-warning-surface text-warning",
    danger: "bg-danger-surface text-danger",
  }[tone];
  return (
    <div className={`rounded-lg px-4 py-3 text-sm ${styles}`}>{children}</div>
  );
}
