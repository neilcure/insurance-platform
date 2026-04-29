/**
 * Extracts a human-friendly display name from a policy snapshot.
 *
 * Shared between:
 *   • EntityPickerDrawer (wizard UI)         — search + display
 *   • entity-resolver    (import server)     — fall back to name lookup when
 *                                               the user types a company name
 *                                               instead of a record number,
 *                                               and surface the resolved name
 *                                               on the import staging review.
 *
 * The picker and the importer MUST agree on what the "display name" is —
 * otherwise admins would search for "Acme" in the wizard but type "Acme Ltd"
 * in the spreadsheet (or vice versa) and the lookup would fail.
 */
import { getInsuredDisplayName } from "@/lib/field-resolver";

export type EntitySnapshot = {
  insuredSnapshot?: Record<string, unknown> | null;
  packagesSnapshot?: Record<string, unknown> | null;
} & Record<string, unknown>;

function norm(k: string): string {
  return k.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");
}

/** Field-name segments we never treat as "the entity's name". */
const SKIP_KEYS = /district|area|region|street|block|floor|flat|room|address|city|state|zip|postal|country|phone|tel|fax|mobile|email|account|number|date|remark|note|memo/;

/**
 * Walk the snapshot in priority order:
 *   1. **insuredSnapshot** — the canonical place for the policyholder's name.
 *      Tried FIRST so a policy with a personal insured (e.g. "Chan Tai Man")
 *      doesn't accidentally surface a *driver's* name (e.g. "Hung Wai Yip")
 *      from the driver package's top-level `firstName`/`lastName` fields.
 *   2. The **insured** package's values (when no insuredSnapshot).
 *   3. Any other package — first/last name, then company name, then full name.
 *   4. Package-key match (e.g. collaborator__collaborator).
 *   5. Any field whose normalised name contains name/broker/agent/company/insurer.
 *   6. insured-snapshot company/full-name fallback.
 *
 * Returns the empty string when no candidate is found — the caller should
 * fall back to the policyNumber in that case.
 */
export function extractDisplayName(snapshot: EntitySnapshot | null | undefined): string {
  if (!snapshot) return "";

  // 1. CANONICAL INSURED FIRST. Reuses the shared resolver so the picker
  //    label matches what the rest of the app shows for the insured
  //    (header chips, PDF templates, audit logs). Critical for policies
  //    that also have driver / contact / collaborator packages with
  //    their own `firstName` / `lastName` fields — without this guard,
  //    whichever package the JSON happens to enumerate first wins, and
  //    the picker can show a driver's or broker's name instead of the
  //    policyholder's.
  const insured = (snapshot.insuredSnapshot ?? null) as Record<string, unknown> | null;
  const insuredName = getInsuredDisplayName(insured);
  if (insuredName) return insuredName;

  const pkgs = (snapshot.packagesSnapshot ?? {}) as Record<string, unknown>;

  // 2. Iterate packages with `insured` first so personal-insured policies
  //    that only have the canonical name in the package snapshot (not in
  //    `insuredSnapshot`) still resolve correctly before any driver /
  //    collaborator package gets a chance.
  const orderedPkgKeys = Object.keys(pkgs).sort((a, b) => {
    const aIns = a.toLowerCase() === "insured" ? 0 : 1;
    const bIns = b.toLowerCase() === "insured" ? 0 : 1;
    return aIns - bIns;
  });

  for (const pkgKey of orderedPkgKeys) {
    const data = pkgs[pkgKey];
    if (!data || typeof data !== "object") continue;
    const structured = data as { values?: Record<string, unknown> };
    const vals = structured.values ?? (data as Record<string, unknown>);
    if (!vals || typeof vals !== "object") continue;

    let firstName = "", lastName = "";
    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (!lastName && /lastname|surname|lname/.test(n)) lastName = s;
      if (!firstName && /firstname|fname/.test(n)) firstName = s;
    }
    if (firstName || lastName) return [lastName, firstName].filter(Boolean).join(" ");

    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (/companyname|organisationname|orgname|corporatename|firmname/.test(n)) return s;
    }

    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (/fullname|displayname|^name$|title|label/.test(n)) return s;
    }

    const pkgNorm = pkgKey.toLowerCase().replace(/[^a-z]/g, "");
    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s || typeof v !== "string") continue;
      if (n === pkgNorm && s.length > 1 && !SKIP_KEYS.test(n)) return s;
    }

    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s || typeof v !== "string") continue;
      if (/name|broker|agent|company|insurer|vendor|supplier|partner/.test(n) && !SKIP_KEYS.test(n)) return s;
    }
  }

  if (insured) {
    for (const [k, v] of Object.entries(insured)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (/companyname|fullname|^name$|organisationname/.test(n)) return s;
    }
  }
  return "";
}

/**
 * Case-insensitive trim+collapse-whitespace comparison key.
 * Used by the import resolver so "CI Plus  Insurance Agency Ltd" and
 * "ci plus insurance agency ltd" map to the same record.
 */
export function normaliseNameForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
