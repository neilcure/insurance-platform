import { z } from "zod";

const toOptionalTrimmedString = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? undefined : t;
  }
  return v;
};

export const PersonalInfoSchema = z.object({
  personalName: z.string().min(1, "Name is required").max(200),
  mobile: z.preprocess(toOptionalTrimmedString, z.string().max(64).optional()),
  timezone: z.preprocess(toOptionalTrimmedString, z.string().max(255).optional()),
});

export const OrganisationInfoSchema = z.object({
  organisationName: z.preprocess(toOptionalTrimmedString, z.string().min(1, "Organisation name is required").max(255).optional()),
  contactName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  contactEmail: z.preprocess(toOptionalTrimmedString, z.string().email("Invalid email").optional()),
  contactPhone: z.preprocess(toOptionalTrimmedString, z.string().optional()),
});

export const AddressSchema = z.object({
  flatNumber: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  floorNumber: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  blockNumber: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  blockName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  streetNumber: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  streetName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  propertyName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  districtName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  area: z.preprocess(toOptionalTrimmedString, z.string().optional()),
});

export const AccountWizardSchema = PersonalInfoSchema.and(OrganisationInfoSchema).and(AddressSchema);

export type PersonalInfoInput = z.infer<typeof PersonalInfoSchema>;
export type OrganisationInfoInput = z.infer<typeof OrganisationInfoSchema>;
export type AddressInput = z.infer<typeof AddressSchema>;
export type AccountWizardInput = z.infer<typeof AccountWizardSchema>;

