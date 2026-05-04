/**
 * Document visibility & audience gate — single source of truth for
 * "can user X see / generate / send / receive document Y on policy Z?"
 *
 * This module is **client-safe**: it MUST NOT statically import `db`,
 * `@/lib/policy-access`, `next-auth`, or any other Node-only dependency.
 * If you import it from a `"use client"` component, Turbopack will only
 * ship the pure helpers — no Postgres → no `fs` / `net` / `tls` errors.
 *
 * Server routes compose Layer 2 (policy scope) by passing `verifyPolicyScope`
 * into `resolveDocumentVisibility()` / `assertDocumentAudience()`, usually
 * as `(u, pid) => canAccessPolicy({ id: Number(u.id), userType: u.userType ?? "" }, pid)`.
 *
 * See `.cursor/skills/document-user-rights/SKILL.md` for the full contract.
 */

/** Minimal user shape needed for audience + scope checks — avoid importing `SessionUser` from `require-user.ts` here (that file pulls NextAuth server code into any bundle that parses it eagerly in some setups). Routes should pass session user shaped like this. */
export type AudienceScopeUser = {
  id: string;
  userType?: string;
};

/** Injected Layer-2 verifier so this module stays free of `@/db` / `policy-access` imports. */
export type PolicyScopeVerifier = (
  user: AudienceScopeUser,
  policyId: number,
) => Promise<boolean>;

/** The two doc audiences we model today. Keep in sync with
 *  `DocumentTemplateSection.audience`, `PdfFieldMapping.audience`, and
 *  the document-tracking key suffix convention (`_agent` for agent
 *  copies). "all" is a template-level opt-out of audience gating — any
 *  authenticated caller who passes scope can see it; use sparingly. */
export type DocumentAudience = "client" | "agent";

/** Shape accepted by the helper. Both `DocumentTemplateMeta` (HTML
 *  templates) and `PdfTemplateMeta` (PDF mail-merge templates) satisfy
 *  this — they share the same three audience flags. Pass a literal
 *  `{}` for generic "authenticated user action on a policy" checks.
 *
 *  `sections` is intentionally typed loosely (`unknown[]`) so both the
 *  HTML `TemplateSection` (which carries `audience?: "client" | "agent"`)
 *  and the PDF `PdfTemplateSection` (no audience field) satisfy it. The
 *  helper pulls `audience` off only when it actually exists. */
export type AudienceDescriptor = {
  isAgentTemplate?: boolean;
  enableAgentCopy?: boolean;
  sections?: ReadonlyArray<unknown> | null;
};

/**
 * PDF Mail Merge templates are usually insurer/internal forms. Existing rows
 * created before the Document Audience dropdown have neither flag saved; do
 * NOT treat that legacy empty state as client-visible. Once an admin opens
 * Template Settings and explicitly saves "Client Only", both flags are
 * present as false and the template becomes client-visible.
 */
export function pdfTemplateAudienceDescriptor(
  meta: AudienceDescriptor | null | undefined,
): AudienceDescriptor {
  if (!meta) return { isAgentTemplate: true, enableAgentCopy: false };
  const hasExplicitAudience =
    Object.prototype.hasOwnProperty.call(meta, "isAgentTemplate")
    || Object.prototype.hasOwnProperty.call(meta, "enableAgentCopy");
  if (!hasExplicitAudience) {
    return { ...meta, isAgentTemplate: true, enableAgentCopy: false };
  }
  return meta;
}

export type DocumentVisibility =
  | {
      allowed: true;
      allowedAudiences: DocumentAudience[];
    }
  | {
      allowed: false;
      reason: "role" | "scope" | "audience";
    };

/** Role shorthand. Split out so the matrix is readable. */
type NormalizedRole =
  | "staff"
  | "agent"
  | "direct_client"
  | "other";

function normalizeRole(userType: string | undefined): NormalizedRole {
  switch (userType) {
    case "admin":
    case "internal_staff":
    case "accounting":
      return "staff";
    case "agent":
      return "agent";
    case "direct_client":
      return "direct_client";
    default:
      return "other";
  }
}

/**
 * Role → audiences the role is *ever* permitted to see. Policy scope
 * is enforced separately via `verifyPolicyScope`.
 */
function audiencesForRole(role: NormalizedRole): DocumentAudience[] {
  switch (role) {
    case "staff":
    case "agent":
      return ["client", "agent"];
    case "direct_client":
      return ["client"];
    case "other":
      return ["client"];
  }
}

function audiencesOfferedBy(meta: AudienceDescriptor): DocumentAudience[] {
  const offered = new Set<DocumentAudience>();

  if (meta.isAgentTemplate && !meta.enableAgentCopy) {
    offered.add("agent");
  } else if (meta.enableAgentCopy) {
    offered.add("client");
    offered.add("agent");
  } else if (meta.isAgentTemplate && meta.enableAgentCopy) {
    offered.add("client");
    offered.add("agent");
  } else {
    offered.add("client");
  }

  if (Array.isArray(meta.sections)) {
    for (const s of meta.sections) {
      if (s && typeof s === "object" && "audience" in s) {
        const a = (s as { audience?: unknown }).audience;
        if (a === "client") offered.add("client");
        if (a === "agent") offered.add("agent");
      }
    }
  }

  return [...offered];
}

/**
 * Async full check: role → policy scope → audience intersect.
 *
 * **`verifyPolicyScope`** is required — routes pass `canAccessPolicy` here.
 */
export async function resolveDocumentVisibility(
  user: AudienceScopeUser,
  policyId: number,
  meta: AudienceDescriptor | null | undefined,
  verifyPolicyScope: PolicyScopeVerifier,
): Promise<DocumentVisibility> {
  const role = normalizeRole(user.userType);
  const roleAudiences = audiencesForRole(role);
  if (roleAudiences.length === 0) {
    return { allowed: false, reason: "role" };
  }

  const hasScope = await verifyPolicyScope(user, policyId);
  if (!hasScope) {
    return { allowed: false, reason: "scope" };
  }

  const offered = audiencesOfferedBy(meta ?? {});
  const allowedAudiences = offered.filter((a) => roleAudiences.includes(a));

  if (allowedAudiences.length === 0) {
    return { allowed: false, reason: "audience" };
  }

  return { allowed: true, allowedAudiences };
}

/**
 * Pure / sync variant — same audience math, **without** the DB scope
 * check. Safe for client components (`DocumentsTab`).
 */
export function audienceVisibilityForRole(
  userType: string | undefined,
  meta: AudienceDescriptor | null | undefined,
): { allowedAudiences: DocumentAudience[] } {
  const role = normalizeRole(userType);
  const roleAudiences = audiencesForRole(role);
  const offered = audiencesOfferedBy(meta ?? {});
  return { allowedAudiences: offered.filter((a) => roleAudiences.includes(a)) };
}

/**
 * Role-only audience capability. Use this when a caller needs the role matrix
 * itself, before it has a concrete template meta to intersect with.
 */
export function allowedAudiencesForRole(userType: string | undefined): DocumentAudience[] {
  return audiencesForRole(normalizeRole(userType));
}

/**
 * Convenience wrapper for route handlers — throws instead of returning
 * `{ allowed: false }`.
 */
export async function assertDocumentAudience(
  user: AudienceScopeUser,
  policyId: number,
  meta: AudienceDescriptor | null | undefined,
  verifyPolicyScope: PolicyScopeVerifier,
  requestedAudience?: DocumentAudience,
): Promise<DocumentAudience[]> {
  const decision = await resolveDocumentVisibility(user, policyId, meta, verifyPolicyScope);
  if (!decision.allowed) {
    const err = new Error(
      decision.reason === "scope"
        ? "Forbidden: no access to policy"
        : decision.reason === "audience"
          ? "Forbidden: audience restricted"
          : "Forbidden: role not permitted",
    ) as Error & { status?: number; reason?: string };
    err.status = 403;
    err.reason = decision.reason;
    throw err;
  }
  if (requestedAudience && !decision.allowedAudiences.includes(requestedAudience)) {
    const err = new Error("Forbidden: audience restricted") as Error & {
      status?: number;
      reason?: string;
    };
    err.status = 403;
    err.reason = "audience";
    throw err;
  }
  return decision.allowedAudiences;
}

export function filterTemplatesByRole<T extends { meta?: AudienceDescriptor | null }>(
  userType: string | undefined,
  rows: T[],
): T[] {
  const role = normalizeRole(userType);
  const roleAudiences = audiencesForRole(role);
  return rows.filter((row) => {
    const offered = audiencesOfferedBy(row.meta ?? {});
    return offered.some((a) => roleAudiences.includes(a));
  });
}
