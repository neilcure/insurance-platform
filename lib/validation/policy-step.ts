import { z } from "zod";

const optionalNumber = z.preprocess(
  (val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const n = typeof val === "string" ? Number(val) : (val as number);
    return Number.isNaN(n) ? undefined : n;
  },
  z.number().optional()
);

const basePolicyFields = {
  agentId: optionalNumber,
  clientId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z.number().optional()
  ),
  insurerOrgId: z.preprocess(
    (v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      const n = typeof v === "string" ? Number(v) : (v as number);
      return Number.isNaN(n) ? undefined : n;
    },
    z.number().int().min(1, "Insurer organisation is required")
  ),
  broker: z.string().optional(),
  covernoteNo: z.string().optional(),
  insurerPolicyNo: z.string().optional(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  ncbPercent: optionalNumber.refine(
    (v) => v === undefined || (v >= 0 && v <= 100),
    "NCB percent must be 0-100"
  ),
  currency: z.string().default("HKD"),
  grossPremium: z.preprocess((v) => Number(v), z.number()),
  netPremium: optionalNumber,
  tpbi: optionalNumber,
  tppd: optionalNumber,
};

export const ThirdPartyPolicySchema = z.object({
  coverType: z.literal("third_party"),
  ...basePolicyFields,
});

export const ComprehensivePolicySchema = z.object({
  coverType: z.literal("comprehensive"),
  ...basePolicyFields,
  excessSection1: z.object({
    od: optionalNumber,
    t: optionalNumber,
    y: optionalNumber,
    i: optionalNumber,
    u: optionalNumber,
    p: optionalNumber,
  }),
});

export const PolicyStepSchema = z.discriminatedUnion("coverType", [
  ThirdPartyPolicySchema,
  ComprehensivePolicySchema,
]);

export type PolicyStepInput = z.infer<typeof PolicyStepSchema>;





