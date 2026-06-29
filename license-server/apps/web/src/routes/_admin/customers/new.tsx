import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeftIcon, CheckCircle2Icon, CopyIcon } from "lucide-react";

import { SiteHeader } from "#/components/site-header.tsx";
import { PageContainer } from "#/components/page-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { ANNUAL_TIERS, ApiError, api } from "#/lib/api.ts";

export const Route = createFileRoute("/_admin/customers/new")({
  component: NewCustomerPage,
});

/**
 * Plan choices for a new customer: a Trial sized to a custom page count (the
 * usual onboarding case) plus the standard annual tiers (so Sales can hand out a
 * trial already sized to the plan the customer intends to buy). `limit: null`
 * means "type an exact number".
 */
const PLAN_OPTIONS: { label: string; limit: number | null }[] = [
  { label: "Trial (custom pages)", limit: null },
  ...ANNUAL_TIERS,
];

/** Default trial expiry: 15 days out, as a yyyy-mm-dd string for the date input. */
function defaultExpiry(): string {
  const d = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** One year from today (annual plan renewal date), as a yyyy-mm-dd string. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function yearAfter(date: string): string {
  const d = date ? new Date(date) : new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

type Result = {
  customerEmail: string;
  temporaryPassword: string;
  key: string;
  orgName: string;
};

/**
 * Sales onboarding flow: create a customer (organization + owner user + trial
 * license) and reveal the API key + temporary password once for Sales to relay.
 */
function NewCustomerPage() {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [tierIndex, setTierIndex] = useState("0");
  const [customLimit, setCustomLimit] = useState("1000");
  const [expiry, setExpiry] = useState(defaultExpiry());
  // Paid term: "auto" = starts today, expires +1yr; "custom" = operator dates.
  const [termMode, setTermMode] = useState<"auto" | "custom">("auto");
  const [startDate, setStartDate] = useState(todayStr());
  const [expiryDate, setExpiryDate] = useState(yearAfter(todayStr()));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const tier = PLAN_OPTIONS[Number(tierIndex)] ?? PLAN_OPTIONS[0]!;
  const isTrial = Number(tierIndex) === 0;
  const isCustomTier = tier.limit === null;
  const resolvedLimit = isCustomTier ? Number(customLimit) : tier.limit!;
  const isCustomTerm = !isTrial && termMode === "custom";

  function reset() {
    setOrgName("");
    setCustomerName("");
    setCustomerEmail("");
    setTierIndex("0");
    setCustomLimit("1000");
    setExpiry(defaultExpiry());
    setTermMode("auto");
    setStartDate(todayStr());
    setExpiryDate(yearAfter(todayStr()));
    setResult(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!orgName.trim() || !customerName.trim() || !customerEmail.trim()) {
      toast.error("Company, contact name, and customer email are required.");
      return;
    }
    if (!Number.isFinite(resolvedLimit) || resolvedLimit <= 0) {
      toast.error("Enter a positive page limit.");
      return;
    }
    if (isTrial && !expiry) {
      toast.error("Set a trial expiry date.");
      return;
    }
    if (isCustomTerm) {
      if (!startDate || !expiryDate) {
        toast.error("Set both a start and an expiry date.");
        return;
      }
      if (new Date(expiryDate).getTime() <= new Date(startDate).getTime()) {
        toast.error("Expiry date must be after the start date.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await api.createCustomer({
        orgName: orgName.trim(),
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        kind: isTrial ? "trial" : "paid",
        limit: resolvedLimit,
        window: "year",
        ...(isTrial ? { trialEndsAt: new Date(expiry).toISOString() } : {}),
        ...(isCustomTerm
          ? {
              startsAt: new Date(startDate).toISOString(),
              expiresAt: new Date(expiryDate).toISOString(),
            }
          : {}),
      });
      setResult({
        customerEmail: res.customerEmail,
        temporaryPassword: res.temporaryPassword,
        key: res.key,
        orgName: res.organization.name,
      });
      toast.success(
        "Customer created. Share the credentials below — shown once.",
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not create customer.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SiteHeader
        title="New customer"
        actions={
          <Button variant="outline" size="sm" render={<Link to="/customers" />}>
            <ArrowLeftIcon />
            Back to customers
          </Button>
        }
      />
      <PageContainer>
        <div className="mx-auto w-full max-w-2xl">
          {result ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-5 text-success" />
                  <CardTitle>Customer created</CardTitle>
                </div>
                <CardDescription>
                  <strong>{result.orgName}</strong> is set up. Copy these now —
                  for security they are shown only once.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <CopyField
                  label="Customer email (login)"
                  value={result.customerEmail}
                />
                <CopyField
                  label="Temporary password"
                  value={result.temporaryPassword}
                />
                <CopyField label="API key" value={result.key} />
                <p className="text-xs text-muted-foreground">
                  The customer signs in at the dashboard with the email +
                  temporary password and should change it after first login.
                </p>
                <div className="flex gap-2">
                  <Button render={<Link to="/customers" />}>Done</Button>
                  <Button variant="outline" onClick={reset}>
                    Create another
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>New customer</CardTitle>
                <CardDescription>
                  Create the customer’s organization, owner login, and a license
                  — a trial (with an expiry date) or a paid annual plan. The API
                  key and a temporary password are shown once — relay them to
                  the customer.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-4" onSubmit={submit}>
                  <div className="grid gap-1.5">
                    <Label htmlFor="orgName">Company</Label>
                    <Input
                      id="orgName"
                      value={orgName}
                      onChange={(event) => setOrgName(event.target.value)}
                      placeholder="Acme Inc."
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="customerName">Contact name</Label>
                    <Input
                      id="customerName"
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      placeholder="Jane Doe"
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="customerEmail">Customer email</Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      value={customerEmail}
                      onChange={(event) => setCustomerEmail(event.target.value)}
                      placeholder="jane@acme.com"
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="tier">Plan</Label>
                    <Select
                      value={tierIndex}
                      onValueChange={(v) => setTierIndex(v ?? "0")}
                    >
                      <SelectTrigger id="tier">
                        <SelectValue>{tier.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PLAN_OPTIONS.map((t, i) => (
                          <SelectItem key={t.label} value={String(i)}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {isCustomTier ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor="customLimit">
                        {Number(tierIndex) === 0
                          ? "Trial page limit"
                          : "Custom annual page limit"}
                      </Label>
                      <Input
                        id="customLimit"
                        type="number"
                        min={1}
                        value={customLimit}
                        onChange={(event) => setCustomLimit(event.target.value)}
                      />
                    </div>
                  ) : null}

                  {isTrial ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor="expiry">Trial expiry date</Label>
                      <Input
                        id="expiry"
                        type="date"
                        value={expiry}
                        onChange={(event) => setExpiry(event.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-1.5">
                        <Label htmlFor="term">Term</Label>
                        <Select
                          value={termMode}
                          onValueChange={(v) =>
                            setTermMode((v as "auto" | "custom") ?? "auto")
                          }
                        >
                          <SelectTrigger id="term">
                            <SelectValue>
                              {termMode === "auto"
                                ? "1 year from today"
                                : "Custom dates"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">
                              1 year from today
                            </SelectItem>
                            <SelectItem value="custom">Custom dates</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {isCustomTerm ? (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor="startDate">Start date</Label>
                            <Input
                              id="startDate"
                              type="date"
                              value={startDate}
                              onChange={(event) =>
                                setStartDate(event.target.value)
                              }
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="expiryDate">Expiry date</Label>
                            <Input
                              id="expiryDate"
                              type="date"
                              min={startDate}
                              value={expiryDate}
                              onChange={(event) =>
                                setExpiryDate(event.target.value)
                              }
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-1.5">
                          <Label htmlFor="plan-expiry">Plan expiry date</Label>
                          <Input
                            id="plan-expiry"
                            type="date"
                            value={yearAfter(todayStr())}
                            disabled
                          />
                          <p className="text-xs text-muted-foreground">
                            Annual plan — renews one year from today.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex gap-2 pt-2">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? "Creating…" : "Create customer"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate({ to: "/customers" })}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </PageContainer>
    </>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-border bg-muted-surface px-3 py-2 text-sm break-all">
          {value}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success("Copied.");
          }}
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  );
}
