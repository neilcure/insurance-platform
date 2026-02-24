import { z } from "zod";

// Helper to treat "" and NaN as undefined for optional numeric inputs
const optionalNumber = z.preprocess(
  (val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const n = typeof val === "string" ? Number(val) : (val as number);
    return Number.isNaN(n) ? undefined : n;
  },
  z.number().optional()
);

/* Common vehicle fields */
const commonVehicleFields = {
  // Keep plateNo required to honor existing DB constraint and workflow
  plateNo: z.string().min(1, "Registration Mark is required"),
  make: z.string().optional(),
  model: z.string().optional(),
  year: optionalNumber,
  bodyType: z.string().optional(),
  engineNo: z.string().optional(),
  chassisNo: z.string().optional(),
  sumInsured: optionalNumber,
};

/* Commercial vehicle schema */
const CommercialVehicleSchemaBase = z.object({
  vehicleCategory: z.literal("commercial"),
  ...commonVehicleFields,
  weight: optionalNumber,
  tonnes: optionalNumber,
  tailgate: z.boolean().optional(),
  accessories: z.boolean().optional(),
  accessoriesName: z.string().optional(),
  accessoriesPrice: optionalNumber,
}).passthrough();

export const CommercialVehicleSchema = CommercialVehicleSchemaBase.superRefine(
  (data, ctx) => {
    if (data.accessories === true) {
      if (!data.accessoriesName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accessoriesName"],
          message: "Accessories name is required when accessories = yes",
        });
      }
      if (
        data.accessoriesPrice === undefined ||
        data.accessoriesPrice === null ||
        Number.isNaN(data.accessoriesPrice)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accessoriesPrice"],
          message: "Accessories price is required when accessories = yes",
        });
      }
    }
  }
);

/* Private vehicle schema */
export const PrivateVehicleSchema = z.object({
  vehicleCategory: z.literal("private"),
  ...commonVehicleFields,
  seats: optionalNumber,
  alarmMake: z.string().optional(),
  alarmModel: z.string().optional(),
}).passthrough();

/* Solo vehicle schema */
export const SoloVehicleSchema = z.object({
  vehicleCategory: z.literal("solo"),
  ...commonVehicleFields,
  seats: optionalNumber,
  alarmMake: z.string().optional(),
  alarmModel: z.string().optional(),
}).passthrough();

export const VehicleStepSchema = z.preprocess((data) => {
  if (data && typeof data === "object" && "vehicleCategory" in (data as any)) {
    const raw = String((data as any).vehicleCategory ?? "").toLowerCase();
    const mapped =
      raw.includes("commercial") ? "commercial" :
      raw.includes("solo") ? "solo" :
      raw.includes("private") ? "private" :
      (["commercial", "private", "solo"].includes(raw) ? raw : "private");
    (data as any).vehicleCategory = mapped;
  }
  return data;
}, z.discriminatedUnion("vehicleCategory", [
  CommercialVehicleSchema,
  PrivateVehicleSchema,
  SoloVehicleSchema,
]));

export type VehicleStepInput = z.infer<typeof VehicleStepSchema>;


