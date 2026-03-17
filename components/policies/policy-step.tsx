"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  PolicyStepSchema,
  type PolicyStepInput,
} from "@/lib/validation/policy-step";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Field } from "@/components/ui/form-field";
import { toast } from "sonner";
import { Button as UIButton } from "@/components/ui/button";

export function PolicyStep({ onComplete, initialValues, flowKey }: { onComplete: (data: PolicyStepInput) => void; initialValues?: Partial<PolicyStepInput>; flowKey?: string | null }) {
  const form = useForm<PolicyStepInput>({
    resolver: zodResolver(PolicyStepSchema),
    defaultValues: {
      currency: "HKD",
      ...(initialValues ?? {}),
    } as any,
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  const [userType, setUserType] = React.useState<string>("");
  const [agents, setAgents] = React.useState<Array<{ id: number; userNumber?: string | null; name?: string | null; email: string }>>([]);
  const [loadingAgents, setLoadingAgents] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const meRes = await fetch("/api/account/info", { cache: "no-store" });
        if (!meRes.ok) return;
        const me = (await meRes.json()) as { user?: { userType?: string } | null };
        const ut = String(me?.user?.userType ?? "");
        if (!mounted) return;
        setUserType(ut);
        if (ut === "admin" || ut === "internal_staff") {
          setLoadingAgents(true);
          const aRes = await fetch("/api/agents", { cache: "no-store" });
          if (aRes.ok) {
            const list = (await aRes.json()) as Array<{ id: number; userNumber?: string | null; name?: string | null; email: string }>;
            if (!mounted) return;
            setAgents(list);
          }
        }
      } finally {
        setLoadingAgents(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);


  function onSubmit(data: PolicyStepInput) {
    // eslint-disable-next-line no-console
    console.log("STEP 3 RESULT", data);
    toast.success("Step 3 valid. Check console output.");
    onComplete(data);
  }

  function getFirstErrorMessage(errors: Record<string, any>): string | undefined {
    const queue: any[] = [errors];
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object") continue;
      for (const value of Object.values(current)) {
        if (value && typeof value === "object") {
          if (typeof (value as any).message === "string") {
            return (value as any).message as string;
          }
          queue.push(value);
        }
      }
    }
    return undefined;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3 — Policy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Agent selection for admin/internal; agents will be assigned automatically */}
        {(userType === "admin" || userType === "internal_staff") ? (
          <section className="space-y-2">
            <Label>Agent</Label>
            <div className="flex items-center gap-2">
              <select
                className="h-9 min-w-[220px] rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                value={String(form.watch("agentId") ?? "")}
                onChange={(e) => {
                  const v = e.target.value;
                  form.setValue("agentId" as any, v === "" ? undefined : Number(v));
                }}
                disabled={loadingAgents}
              >
                <option value="">Select an agent…</option>
                {agents.map((a) => {
                  const label =
                    (a.userNumber ? `${a.userNumber} — ` : "") +
                    (a.name ?? "") +
                    ` <${a.email}>`;
                  return (
                    <option key={a.id} value={a.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
              {loadingAgents ? <UIButton size="sm" variant="outline" disabled>Loading…</UIButton> : null}
            </div>
          </section>
        ) : null}

        <Separator />

        <section className="grid grid-cols-2 gap-4">
          <Field label="Client ID" type="number" {...form.register("clientId", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
          <Field label="Insurer Org ID" type="number" {...form.register("insurerOrgId", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
          <Field label="Broker" {...form.register("broker")} />
          <Field label="Covernote No" {...form.register("covernoteNo")} />
          <Field label="Insurer Policy No" {...form.register("insurerPolicyNo")} />
          <Field label="Start Date" type="date" {...form.register("startDate")} />
          <Field label="End Date" type="date" {...form.register("endDate")} />
          <Field label="NCB %" type="number" {...form.register("ncbPercent", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
          <Field label="Currency" defaultValue="HKD" {...form.register("currency")} />
          <Field label="Gross Premium" type="number" {...form.register("grossPremium", { setValueAs: (v) => Number(v) })} />
          <Field label="Net Premium" type="number" {...form.register("netPremium", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
          <Field label="TPBI" type="number" {...form.register("tpbi", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
          <Field label="TPPD" type="number" {...form.register("tppd", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
        </section>


        <Separator />
        <div className="flex justify-end">
          <Button
            onClick={() => {
              try {
                const values = form.getValues();
                const parsed = PolicyStepSchema.safeParse(values);
                if (!parsed.success) {
                  const msg =
                    parsed.error?.issues?.[0]?.message ??
                    "Please fill in the required fields.";
                  toast.error(msg);
                  return;
                }
                onSubmit(parsed.data);
              } catch (err: unknown) {
                const message =
                  err && typeof err === "object" && "message" in err
                    ? (err as any).message
                    : "Validation failed";
                toast.error(String(message));
              }
            }}
          >
            Continue (Step 4)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Field extracted to @/components/ui/form-field


