import { z } from "zod";

export const TargetingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({
    mode: z.literal("user_types"),
    userTypes: z.array(z.string()).min(1).max(50),
  }),
  z
    .object({
      mode: z.literal("users"),
      userIds: z.array(z.number().int().positive()).max(500).default([]),
      clientIds: z.array(z.number().int().positive()).max(500).default([]),
    })
    .refine((v) => v.userIds.length + v.clientIds.length > 0, {
      message: "Pick at least one user or client.",
    }),
]);

export type ParsedTargeting = z.infer<typeof TargetingSchema>;

export function parseTargeting(raw: unknown): ParsedTargeting {
  const r = TargetingSchema.safeParse(raw);
  return r.success ? r.data : { mode: "all" };
}
