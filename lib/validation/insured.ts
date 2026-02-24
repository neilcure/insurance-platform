import { z } from "zod";

/**
 * Dynamic insured schema:
 * - Always requires `insuredType` (string)
 * - Accepts arbitrary extra keys via .passthrough()
 * - Enforces required dynamic fields based on meta.required and meta.categories
 *   from the provided dynamic form options.
 */
export type InsuredDynamicField = {
  value: string;
  meta?: {
    inputType?: "string" | "number" | "boolean" | "date";
    required?: boolean;
    categories?: string[]; // e.g. ["company"] | ["personal"] | mixed/custom
  };
};

export function buildInsuredDynamicSchema(fields: InsuredDynamicField[]) {
  // Base accepts any additional keys
  const Base = z.object({
    insuredType: z.string().min(1, "Insured type is required"),
  }).passthrough();

  return Base.superRefine((data, ctx) => {
    const insuredType = String((data as Record<string, unknown>)?.insuredType ?? "").trim();
    if (!insuredType) return;
    for (const f of fields) {
      const categories = (f.meta?.categories ?? []) as string[];
      const applies = categories.length === 0 || categories.includes(insuredType);
      if (!applies) continue;
      if (!f.meta?.required) continue;
      const raw = (data as Record<string, unknown>)[f.value];
      const t = f.meta?.inputType ?? "string";
      const isMissing = (v: unknown) =>
        v === undefined || v === null || (typeof v === "string" && v.trim().length === 0);
      if (isMissing(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [f.value],
          message: "This field is required",
        });
        continue;
      }
      // Basic type checks for common input types
      if (t === "boolean") {
        if (typeof raw !== "boolean") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [f.value],
            message: "Must be true or false",
          });
        }
      } else if (t === "number") {
        const n = typeof raw === "number" ? raw : Number(raw as any);
        if (!Number.isFinite(n)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [f.value],
            message: "Must be a valid number",
          });
        }
      } else if (t === "date") {
        const s = String(raw as any);
        // Accept YYYY-MM-DD or valid Date parse
        const isIso = /^\d{4}-\d{2}-\d{2}$/.test(s);
        const time = isIso ? Date.parse(s) : Date.parse(s);
        if (!Number.isFinite(time)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [f.value],
            message: "Must be a valid date",
          });
        }
      } else {
        // string-like
        if (typeof raw !== "string" || raw.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [f.value],
            message: "Must be a non-empty string",
          });
        }
      }
    }
  });
}

