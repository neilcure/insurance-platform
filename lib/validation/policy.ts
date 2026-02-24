import { z } from "zod";

export const carSchema = z.object({
  plateNumber: z.string().min(1),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
});

export const policyCreateSchema = z.object({
  policyNumber: z.string().min(1),
  organisationId: z.number().int(),
  car: carSchema,
});

export type PolicyCreateInput = z.infer<typeof policyCreateSchema>;


