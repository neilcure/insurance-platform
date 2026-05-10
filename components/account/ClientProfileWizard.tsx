"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, MapPin, Save } from "lucide-react";
import { PackageBlock } from "@/components/policies/PackageBlock";
import { AddressTool, type AddressFieldMap } from "@/components/policies/address-tool";
import { discoverAddressFields } from "@/lib/address/discover-fields";
import { getInsuredDisplayName, getInsuredType, getInsuredPrimaryId, getContactField } from "@/lib/field-resolver";

type ClientData = {
  id: number;
  clientNumber: string;
  category: string;
  displayName: string;
  primaryId: string;
  contactPhone: string | null;
  extraAttributes: Record<string, unknown>;
};

type StepMeta = {
  packages?: string[];
  packageCategories?: Record<string, string[]>;
  packageShowWhen?: Record<string, unknown>;
  packageGroupLabelsHidden?: Record<string, boolean>;
};

type FlowStep = {
  value: string;
  label: string;
  sortOrder: number;
  meta?: StepMeta | null;
};

type Props = {
  userName: string | null;
  userEmail: string;
  userTimezone: string | null;
};

export function ClientProfileWizard({ userName, userEmail, userTimezone }: Props) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [client, setClient] = React.useState<ClientData | null>(null);
  const [packages, setPackages] = React.useState<string[]>([]);
  const [packageCategories, setPackageCategories] = React.useState<Record<string, string[]>>({});
  const [groupLabelsHidden, setGroupLabelsHidden] = React.useState<Record<string, boolean>>({});

  const [personalName, setPersonalName] = React.useState(userName ?? "");
  const [timezone, setTimezone] = React.useState(userTimezone ?? "Asia/Hong_Kong");
  const [tzOptions, setTzOptions] = React.useState<string[]>(["Asia/Hong_Kong"]);
  const [addressFieldMap, setAddressFieldMap] = React.useState<AddressFieldMap>({});
  const [areaOptions, setAreaOptions] = React.useState<{ label?: string; value?: string }[]>([]);

  const form = useForm<Record<string, unknown>>({ defaultValues: {} });

  React.useEffect(() => {
    try {
      const hasSupportedValuesOf = typeof (Intl as any).supportedValuesOf === "function";
      const list = hasSupportedValuesOf ? ((Intl as any).supportedValuesOf("timeZone") as string[]) : [];
      const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const base = Array.isArray(list) && list.length > 0 ? list : ["Asia/Hong_Kong", current].filter(Boolean);
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const z of [userTimezone, current, ...base]) {
        if (!z) continue;
        if (seen.has(z)) continue;
        seen.add(z);
        ordered.push(z);
      }
      setTzOptions(ordered);
    } catch {
      setTzOptions(["Asia/Hong_Kong"]);
    }
  }, [userTimezone]);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [profileRes, stepsRes] = await Promise.all([
          fetch("/api/account/client-profile", { cache: "no-store" }),
          fetch("/api/form-options?groupKey=flow_clientSet_steps", { cache: "no-store" }),
        ]);

        if (cancelled) return;

        // Load client profile data
        if (profileRes.ok) {
          const pj = await profileRes.json();
          const c = pj.client as ClientData | null;
          setClient(c);
          if (c) {
            const initial: Record<string, unknown> = {};
            const extra = c.extraAttributes ?? {};
            for (const [k, v] of Object.entries(extra)) {
              if (k.startsWith("_")) continue;
              initial[k] = v;
            }
            form.reset(initial);
          }
        }

        // Load flow steps to know which packages to render
        if (stepsRes.ok) {
          const steps = (await stepsRes.json()) as FlowStep[];
          const allPkgs: string[] = [];
          const allCats: Record<string, string[]> = {};
          const allHidden: Record<string, boolean> = {};

          const sorted = (Array.isArray(steps) ? steps : []).sort(
            (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
          );

          for (const step of sorted) {
            const meta = step.meta;
            if (meta?.packages) {
              for (const p of meta.packages) {
                if (!allPkgs.includes(p)) allPkgs.push(p);
              }
            }
            if (meta?.packageCategories) {
              Object.assign(allCats, meta.packageCategories);
            }
            if (meta?.packageGroupLabelsHidden) {
              Object.assign(allHidden, meta.packageGroupLabelsHidden);
            }
          }

          setPackages(allPkgs);
          setPackageCategories(allCats);
          setGroupLabelsHidden(allHidden);

          const mergedMap: Record<string, string> = {};
          let mergedAreaOpts: { label?: string; value?: string }[] = [];
          const usedFieldValues = new Set<string>();
          for (const pkg of allPkgs) {
            try {
              const fRes = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`, { cache: "no-store" });
              if (!fRes.ok) continue;
              const rows = (await fRes.json()) as { value?: string; label?: string; meta?: { options?: { label?: string; value?: string }[] } }[];
              const { fieldMap, areaOptions: ao } = discoverAddressFields(rows, pkg, { usedFieldValues });
              for (const [k, v] of Object.entries(fieldMap)) {
                if (v && !mergedMap[k]) mergedMap[k] = v;
              }
              if (ao.length > 0 && mergedAreaOpts.length === 0) mergedAreaOpts = ao;
            } catch {}
          }
          if (!cancelled) {
            setAddressFieldMap(mergedMap as AddressFieldMap);
            setAreaOptions(mergedAreaOpts);
          }
        }
      } catch {
        if (!cancelled) toast.error("Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const userRes = await fetch("/api/account/user", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: personalName || "User", timezone }),
      });
      if (!userRes.ok) throw new Error("Failed to save personal info");

      if (client) {
        const allValues = form.getValues();
        const fields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(allValues)) {
          if (k.startsWith("___")) continue;
          fields[k] = v;
        }

        const category = getInsuredType(fields) || client.category || "personal";
        const displayName = getInsuredDisplayName(fields) || client.displayName;
        const primaryId = getInsuredPrimaryId(fields) || client.primaryId || "";
        const contactPhone = getContactField(fields, "mobile") || getContactField(fields, "tel") || client.contactPhone || "";

        const profileRes = await fetch("/api/account/client-profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category,
            displayName,
            primaryId,
            contactPhone: contactPhone || null,
            fields,
          }),
        });
        if (!profileRes.ok) throw new Error("Failed to save profile");
      }

      toast.success("Profile saved");
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const hasAddressFields = Object.keys(addressFieldMap).length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!client) {
    return (
      <Card className="mx-auto max-w-3xl">
        <CardContent className="py-8 text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No client profile linked to your account. Please contact your administrator.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Personal / Login */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input
              value={personalName}
              onChange={(e) => setPersonalName(e.target.value)}
              placeholder="Your full name"
            />
          </div>
          <div className="grid gap-2">
            <Label>Time zone</Label>
            <select
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            Email: {userEmail}
            <span className="ml-3 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono dark:bg-neutral-800">
              {client.clientNumber}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Address Tool — same as admin flow */}
      {hasAddressFields && (
        <div className="flex justify-end">
          <AddressTool
            form={form}
            fieldMap={addressFieldMap}
            areaOptions={areaOptions}
            trigger={
              <Button type="button" variant="secondary" className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Address Tool
              </Button>
            }
          />
        </div>
      )}

      {/* Dynamic packages — same as admin flow, but category locked to client's type */}
      {packages.map((pkg) => {
        const adminCats = packageCategories[pkg];
        // Lock insured package to client's category — no switching allowed
        const lockedCats = pkg === "insured" && client.category
          ? [client.category.toLowerCase()]
          : adminCats;
        return (
          <Card key={pkg}>
            <CardContent className="pt-6">
              <PackageBlock
                form={form}
                pkg={pkg}
                allowedCategories={lockedCats}
                isAdmin={false}
                hideGroupLabels={!!groupLabelsHidden[pkg]}
              />
            </CardContent>
          </Card>
        );
      })}

      {/* Save */}
      <div className="flex justify-end gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Save Profile
        </Button>
      </div>
    </div>
  );
}
