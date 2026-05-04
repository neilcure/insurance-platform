/**
 * Recipient extraction from policy snapshots — single source of truth.
 *
 * Before this module the same fallback chain was duplicated in:
 *   - components/policies/tabs/WorkflowTab.tsx (defaultEmailRecipient,
 *     defaultPhoneRecipient, defaultRecipientName)
 *   - components/policies/WhatsAppUploadedFilesDialog.tsx (form prefill)
 *   - components/policies/tabs/DocumentsTab.tsx (handleWhatsApp,
 *     handleWhatsAppClick)
 *   - app/api/presence/online/route.ts (different concern — SQL — but
 *     the same key list)
 *
 * Each of those was slightly different (different keys, different
 * order, different normalisation). That meant the same insured could
 * surface a different phone/email depending on which surface the user
 * happened to open. This module centralises the fallback chain.
 *
 * Key naming convention (from `multi-variant-fields.mdc`):
 *   - `${pkg}__${field}` (double underscore) is the canonical RHF
 *     form-name in the wizard.
 *   - `${pkg}_${field}` (single underscore) appears in some legacy
 *     snapshots from the pre-2025 form names.
 *   - The bare `${field}` exists for the synthetic fields the
 *     resolver auto-routes (see `lib/field-resolver.ts`).
 *
 * We try them in that order and return the first non-empty value.
 *
 * Scope boundary: this module is CLIENT-SAFE — it has no `db` or
 * `next-auth` imports. It just operates on a snapshot blob.
 */

type SnapshotShape = Record<string, unknown> | null | undefined;

function readString(record: SnapshotShape, ...keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = (record as Record<string, unknown>)[key];
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Resolve the insured's email from a policy snapshot's
 * `insuredSnapshot` blob. Returns `""` (not `null`) so it slots
 * directly into form `defaultValue` props.
 *
 * Order matches the previous duplicated copies in WorkflowTab +
 * EmailUploadedFilesDialog so the refactor is behaviour-preserving.
 */
export function getDefaultEmailFromInsured(insured: SnapshotShape): string {
  return readString(
    insured,
    "email",
    "contactinfo__email",
    "contactinfo_email",
    "contact_email",
  );
}

/**
 * Resolve the insured's mobile/phone. We prefer mobile keys over
 * landline because WhatsApp is mobile-first; the `tel*` keys are
 * the trailing fallback.
 *
 * Returns `""` for "no number on file" — callers should pass it
 * straight to `normalizeForWhatsApp` which will return `null` for
 * an unparseable input.
 */
export function getDefaultPhoneFromInsured(insured: SnapshotShape): string {
  return readString(
    insured,
    "contactinfo__mobile",
    "contactinfo_mobile",
    "mobile",
    "contactPhone",
    "phone",
    "contactinfo__tel",
    "contactinfo_tel",
    "tel",
  );
}

/**
 * Build a display name from the insured snapshot.
 *
 * Personal vs company is detected from `insuredType` /
 * `insured__category` / `category` — same heuristic the wizard uses.
 *
 * Name shape mirrors the rule in `lib/field-resolver.ts`
 * `getInsuredDisplayName`, but without the DB-side dependencies (so
 * this module stays client-safe).
 */
export function getDefaultRecipientNameFromInsured(insured: SnapshotShape): string {
  if (!insured) return "";

  const isCompany = (() => {
    const t = readString(insured, "insuredType", "insured__category", "category").toLowerCase();
    return t === "company";
  })();

  if (isCompany) {
    return readString(
      insured,
      "insured__companyName",
      "insured_companyName",
      "companyName",
    );
  }

  const last = readString(insured, "insured__lastName", "insured_lastName", "lastName");
  const first = readString(insured, "insured__firstName", "insured_firstName", "firstName");
  return [first, last].filter(Boolean).join(" ");
}

/**
 * Convenience: pull the `insuredSnapshot` blob off a policy
 * `extraAttributes` and run all three resolvers in one call.
 *
 * Returns empty strings (not `null`) for fields that aren't on file
 * so the result drops cleanly into form `defaultValue` props.
 */
export function resolveDefaultRecipientFromExtra(
  extraAttributes: unknown,
): { email: string; phone: string; name: string } {
  const extra = (extraAttributes ?? {}) as Record<string, unknown>;
  const insured = (extra.insuredSnapshot ?? {}) as Record<string, unknown> | undefined;
  return {
    email: getDefaultEmailFromInsured(insured),
    phone: getDefaultPhoneFromInsured(insured),
    name: getDefaultRecipientNameFromInsured(insured),
  };
}
