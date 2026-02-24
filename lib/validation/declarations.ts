import { z } from "zod";

export const DeclarationsSchema = z.object({
  leftHandDrive: z.boolean().default(false),
  modifiedVehicle: z.boolean().default(false),
  accessoriesAdded: z.boolean().default(false),
  lapseInInsurance: z.boolean().default(false),
  noValidHKLicense: z.boolean().default(false),
  deniedOrCancelledBefore: z.boolean().default(false),
  accidentOrConviction: z.boolean().default(false),
  notes: z.string().optional(),
});

export type DeclarationsInput = z.infer<typeof DeclarationsSchema>;

export const DeclarationsDynamicSchema = z.object({
  answers: z.record(z.string(), z.boolean()).default({}),
  notes: z.string().optional(),
});

export type DeclarationsDynamicInput = z.infer<typeof DeclarationsDynamicSchema>;

/**
 * Converts old fixed-key declarations into the new dynamic shape.
 * If the input already matches the dynamic shape, it is returned as-is.
 */
export function normalizeDeclarations(input: unknown): { answers: Record<string, boolean>; notes?: string } | null {
  const dyn = DeclarationsDynamicSchema.safeParse(input);
  if (dyn.success) return dyn.data;
  const old = DeclarationsSchema.safeParse(input);
  if (old.success) {
    const { notes, ...rest } = old.data;
    return {
      answers: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, Boolean(v)])),
      notes,
    };
  }
  return null;
}








