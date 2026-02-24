"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DeclarationsDynamicSchema, type DeclarationsDynamicInput } from "@/lib/validation/declarations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

type PublicOption = {
  id: number;
  label: string;
  value: string;
  valueType: string;
  meta: { helpText?: string; default?: boolean } | null;
  sortOrder: number;
};

export function DeclarationsStep({
  onSubmitFinal,
  isSubmitting,
}: {
  onSubmitFinal: (data: any) => void;
  isSubmitting?: boolean;
}) {
  const form = useForm<DeclarationsDynamicInput>({
    resolver: zodResolver(DeclarationsDynamicSchema),
    defaultValues: { answers: {}, notes: "" },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  const [options, setOptions] = React.useState<PublicOption[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/form-options?groupKey=declarations", { cache: "no-store" });
        const data = (await res.json()) as PublicOption[];
        setOptions(data);
        const defaults: Record<string, boolean> = {};
        for (const o of data) {
          defaults[o.value] = Boolean(o.meta?.default) ?? false;
        }
        form.reset({ answers: defaults, notes: "" });
      } catch {
        toast.error("Failed to load declarations");
      } finally {
        setLoading(false);
      }
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(data: DeclarationsDynamicInput) {
    toast.success("Step 4 valid. Submitting policy...");
    onSubmitFinal({ declarations: data, notes: data.notes, answers: data.answers } as any);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 4 — Declarations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="grid grid-cols-1 gap-3">
          {options.map((opt) => {
            const checked = !!form.getValues().answers?.[opt.value];
            return (
              <label key={opt.id} className="flex items-center gap-3">
                <Checkbox
                  checked={checked}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const currentAnswers = form.getValues().answers ?? {};
                    form.setValue("answers", {
                      ...currentAnswers,
                      [opt.value]: e.target.checked,
                    });
                  }}
                />
                <span className="text-sm">
                  {opt.label}
                  {opt.meta?.helpText ? (
                    <span className="ml-2 text-xs text-neutral-500">{opt.meta.helpText}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
          {!loading && options.length === 0 ? (
            <div className="text-sm text-neutral-500">No declarations available.</div>
          ) : null}
        </section>

        <Separator />

        <div className="grid gap-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Input id="notes" {...form.register("notes")} placeholder="Any relevant notes..." />
        </div>

        <div className="flex justify-end">
          <Button
            disabled={!!isSubmitting}
            onClick={() => {
              try {
                const values = form.getValues();
                const parsed = DeclarationsDynamicSchema.safeParse(values);
                if (!parsed.success) {
                  toast.error("Please review your declarations.");
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
            {isSubmitting ? "Submitting..." : "Submit Policy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

