"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { AddressTool, type AddressFieldMap } from "@/components/policies/address-tool";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  AccountWizardSchema,
  type AccountWizardInput,
  type PersonalInfoInput,
  type OrganisationInfoInput,
  type AddressInput,
} from "@/lib/validation/account";
 import { useRouter } from "next/navigation";

type InitialData = {
  user: { id: number; email: string; name?: string | null } | null;
  organisation:
    | {
        id: number;
        name: string;
        contactName?: string | null;
        contactEmail?: string | null;
        contactPhone?: string | null;
        flatNumber?: string | null;
        floorNumber?: string | null;
        blockNumber?: string | null;
        blockName?: string | null;
        streetNumber?: string | null;
        streetName?: string | null;
        propertyName?: string | null;
        districtName?: string | null;
        area?: string | null;
      }
    | null;
};

const steps = ["Personal", "Organisation", "Address"] as const;

export function AccountInfoWizard({ initial }: { initial: InitialData }) {
  const router = useRouter();
  const [step, setStep] = React.useState<(typeof steps)[number]>("Personal");
  const [tzOptions, setTzOptions] = React.useState<string[]>([]);
  React.useEffect(() => {
    try {
      const hasSupportedValuesOf = typeof (Intl as any).supportedValuesOf === "function";
      const list = hasSupportedValuesOf ? ((Intl as any).supportedValuesOf("timeZone") as string[]) : [];
      const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const base = Array.isArray(list) && list.length > 0 ? list : ["Asia/Hong_Kong", current].filter(Boolean);
      const seen = new Set<string>();
      // Ensure the saved initial timezone (if any) appears at the top so the select shows it explicitly.
      const preferred = (initial.user as any)?.timezone as string | undefined;
      const ordered: string[] = [];
      for (const z of [preferred, current, ...base]) {
        if (!z) continue;
        if (seen.has(z)) continue;
        seen.add(z);
        ordered.push(z);
      }
      setTzOptions(ordered);
    } catch {
      setTzOptions(["Asia/Hong_Kong"]);
    }
  }, [initial.user]);
  const form = useForm<AccountWizardInput>({
    resolver: zodResolver(AccountWizardSchema),
    defaultValues: {
      personalName: initial.user?.name ?? "",
      timezone: (initial.user as any)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Organisation
      ...({
        organisationName: initial.organisation?.name ?? "",
        contactName: initial.organisation?.contactName ?? undefined,
        contactEmail: initial.organisation?.contactEmail ?? initial.user?.email ?? undefined,
        contactPhone: initial.organisation?.contactPhone ?? undefined,
      } as OrganisationInfoInput),
      // Address
      ...({
        flatNumber: initial.organisation?.flatNumber ?? undefined,
        floorNumber: initial.organisation?.floorNumber ?? undefined,
        blockNumber: initial.organisation?.blockNumber ?? undefined,
        blockName: initial.organisation?.blockName ?? undefined,
        streetNumber: initial.organisation?.streetNumber ?? undefined,
        streetName: initial.organisation?.streetName ?? undefined,
        propertyName: initial.organisation?.propertyName ?? undefined,
        districtName: initial.organisation?.districtName ?? undefined,
        area: initial.organisation?.area ?? undefined,
      } as AddressInput),
    },
    mode: "onSubmit",
    reValidateMode: "onBlur",
    criteriaMode: "firstError",
  });

  const fieldMap: AddressFieldMap = {
    flatNumber: "flatNumber",
    floorNumber: "floorNumber",
    blockNumber: "blockNumber",
    blockName: "blockName",
    streetNumber: "streetNumber",
    streetName: "streetName",
    propertyName: "propertyName",
    districtName: "districtName",
    area: "area",
  };

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const pendingAction = React.useRef<(() => Promise<void>) | null>(null);

  const personalFields = ["personalName", "timezone"] as const;
  const orgFields = ["organisationName", "contactName", "contactEmail", "contactPhone"] as const;
  const addressFields = ["flatNumber", "floorNumber", "blockNumber", "blockName", "streetNumber", "streetName", "propertyName", "districtName", "area"] as const;

  function hasStepChanges(fields: readonly string[]) {
    const dirty = form.formState.dirtyFields;
    return fields.some((f) => (dirty as Record<string, boolean>)[f]);
  }

  function getChangedLabels(fields: readonly string[], labels: Record<string, string>) {
    const dirty = form.formState.dirtyFields;
    return fields.filter((f) => (dirty as Record<string, boolean>)[f]).map((f) => labels[f] || f);
  }

  const fieldLabels: Record<string, string> = {
    personalName: "Name", timezone: "Time zone",
    organisationName: "Organisation Name", contactName: "Contact Name",
    contactEmail: "Contact Email", contactPhone: "Contact Phone",
    flatNumber: "Flat", floorNumber: "Floor", blockNumber: "Block No.",
    blockName: "Block Name", streetNumber: "Street No.", streetName: "Street Name",
    propertyName: "Property / Building", districtName: "District", area: "Area",
  };

  function next() {
    setStep((s) => (s === "Personal" ? "Organisation" : s === "Organisation" ? "Address" : "Address"));
  }
  function back() {
    setStep((s) => (s === "Address" ? "Organisation" : s === "Organisation" ? "Personal" : "Personal"));
  }

  async function savePersonal(values: PersonalInfoInput) {
    const res = await fetch("/api/account/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: values.personalName, timezone: (values as any).timezone }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "Failed to save personal info");
    }
  }
  async function saveOrganisation(values: OrganisationInfoInput & AddressInput) {
    const clean = (v?: string | number | null) => {
      if (v === null || v === undefined) return undefined;
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
      if (typeof v !== "string") return undefined;
      const t = v.trim();
      return t.length === 0 ? undefined : t;
    };
    const payload: any = {
      name: clean(values.organisationName),
      contactName: clean(values.contactName as any),
      contactEmail: clean(values.contactEmail as any),
      contactPhone: clean(values.contactPhone as any),
      flatNumber: clean(values.flatNumber as any),
      floorNumber: clean(values.floorNumber as any),
      blockNumber: clean(values.blockNumber as any),
      blockName: clean(values.blockName as any),
      streetNumber: clean(values.streetNumber as any),
      streetName: clean(values.streetName as any),
      propertyName: clean(values.propertyName as any),
      districtName: clean(values.districtName as any),
      area: clean(values.area as any),
    };
    const res = await fetch("/api/account/organisation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "Failed to save organisation info");
    }
  }

  async function doSaveAll(values: AccountWizardInput) {
    try {
      await savePersonal({ personalName: values.personalName });
      await saveOrganisation({
        organisationName: values.organisationName,
        contactName: values.contactName,
        contactEmail: values.contactEmail,
        contactPhone: values.contactPhone,
        flatNumber: values.flatNumber,
        floorNumber: values.floorNumber,
        blockNumber: values.blockNumber,
        blockName: values.blockName,
        streetNumber: values.streetNumber,
        streetName: values.streetName,
        propertyName: values.propertyName,
        districtName: values.districtName,
        area: values.area,
      });
      form.reset(values);
      toast.success("Account information updated");
      router.push("/dashboard");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save");
    }
  }

  function onSubmitAll(values: AccountWizardInput) {
    const allFields = [...personalFields, ...orgFields, ...addressFields] as const;
    if (!hasStepChanges(allFields)) {
      router.push("/dashboard");
      return;
    }
    pendingAction.current = () => doSaveAll(values);
    setConfirmOpen(true);
  }

  const currentStepIndex = steps.indexOf(step);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        {steps.map((s, idx) => (
          <React.Fragment key={s}>
            <button
              type="button"
              onClick={() => setStep(s)}
              className={`rounded-md border px-3 py-1 text-sm ${
                step === s
                  ? "border-neutral-800 bg-neutral-900 text-white dark:border-neutral-200 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-200 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
              }`}
            >
              {s}
            </button>
            {idx < steps.length - 1 ? <Separator className="mx-2 w-8" /> : null}
          </React.Fragment>
        ))}
      </div>

      <form
        className="space-y-6"
        noValidate
        onSubmit={form.handleSubmit(
          onSubmitAll,
          (errors) => {
            // Surface the first error via toast and keep UI stable
            const first = Object.values(errors)[0] as any;
            const msg = first?.message || first?.root?.message || "Please fix the highlighted fields";
            toast.error(String(msg));
          }
        )}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      >
        {step === "Personal" ? (
          <Card>
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="personal_name">Name</Label>
                <Input
                  id="personal_name"
                  {...form.register("personalName")}
                  placeholder="Your full name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="timezone">Time zone</Label>
                <select
                  id="timezone"
                  className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  {...form.register("timezone")}
                >
                  {(tzOptions.length ? tzOptions : ["Asia/Hong_Kong"]).map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-neutral-500 dark:text-neutral-400">Email: {initial.user?.email}</div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      if (!hasStepChanges(personalFields)) {
                        next();
                        return;
                      }
                      pendingAction.current = async () => {
                        const values = form.getValues();
                        await savePersonal({ personalName: values.personalName, timezone: (values as any).timezone });
                        form.reset(form.getValues());
                        toast.success("Saved");
                        next();
                      };
                      setConfirmOpen(true);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === "Organisation" ? (
          <Card>
            <CardHeader>
              <CardTitle>Organisation Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="org_name">Organisation Name</Label>
                <Input id="org_name" {...form.register("organisationName")} placeholder="Company / Organisation" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="contact_name">Contact Name</Label>
                  <Input id="contact_name" {...form.register("contactName")} placeholder="Contact person" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contact_email">Contact Email</Label>
                  <Input id="contact_email" type="email" {...form.register("contactEmail")} placeholder="name@company.com" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contact_phone">Contact Phone</Label>
                  <Input id="contact_phone" {...form.register("contactPhone")} placeholder="Phone number" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Button type="button" variant="outline" onClick={back}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      if (!hasStepChanges(orgFields)) {
                        next();
                        return;
                      }
                      pendingAction.current = async () => {
                        const v = form.getValues();
                        await saveOrganisation({
                          organisationName: v.organisationName,
                          contactName: v.contactName,
                          contactEmail: v.contactEmail,
                          contactPhone: v.contactPhone,
                        });
                        form.reset(form.getValues());
                        try {
                          window.dispatchEvent(new CustomEvent("account:info-changed"));
                        } catch {}
                        toast.success("Saved");
                        next();
                      };
                      setConfirmOpen(true);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === "Address" ? (
          <Card>
            <CardHeader>
              <CardTitle>Organisation Address</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex justify-end">
                <AddressTool
                  form={form as any}
                  fieldMap={fieldMap}
                  trigger={<Button type="button" variant="secondary">Use Address Tool</Button>}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="flatNumber">Flat</Label>
                  <Input id="flatNumber" {...form.register("flatNumber")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="floorNumber">Floor</Label>
                  <Input id="floorNumber" {...form.register("floorNumber")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="blockNumber">Block No.</Label>
                  <Input id="blockNumber" {...form.register("blockNumber")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="blockName">Block Name</Label>
                  <Input id="blockName" {...form.register("blockName")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="streetNumber">Street No.</Label>
                  <Input id="streetNumber" {...form.register("streetNumber")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="streetName">Street Name</Label>
                  <Input id="streetName" {...form.register("streetName")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="propertyName">Property / Building</Label>
                  <Input id="propertyName" {...form.register("propertyName")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="districtName">District</Label>
                  <Input id="districtName" {...form.register("districtName")} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="area">Area (HKI/KLN/NT)</Label>
                  <Input id="area" {...form.register("area")} placeholder="HKI / KLN / NT" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Button type="button" variant="outline" onClick={back}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                  >
                    Completed
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
          Step {currentStepIndex + 1} of {steps.length}
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm changes"
        description="You have unsaved changes. Do you want to save them?"
        confirmLabel="Save"
        onConfirm={async () => {
          if (pendingAction.current) {
            try {
              await pendingAction.current();
            } catch (err: any) {
              toast.error(err?.message ?? "Failed to save");
            } finally {
              pendingAction.current = null;
            }
          }
        }}
      >
        <ul className="mt-2 space-y-1 text-sm text-neutral-700 dark:text-neutral-300">
          {(() => {
            const allFields = [...personalFields, ...orgFields, ...addressFields];
            const changed = getChangedLabels(allFields, fieldLabels);
            return changed.map((label) => (
              <li key={label} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {label}
              </li>
            ));
          })()}
        </ul>
      </ConfirmDialog>
    </div>
  );
}

