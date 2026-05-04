/**
 * Shared PDF template loader for the delivery dialogs.
 *
 * Both `EmailUploadedFilesDialog` and `WhatsAppUploadedFilesDialog`
 * fetched `/api/pdf-templates` and ran the same audience filter
 * inline. This module centralises that contract:
 *
 *   1. Fetch active templates only.
 *   2. Drop agent-only templates (those are surfaced via the
 *      Agent Documents path, not the client-share dialogs).
 *   3. Drop templates whose `showOn` excludes the policy context.
 *   4. When `policyId` is provided, drop templates whose
 *      `meta.insurerPolicyIds` is restricted and doesn't include
 *      any of the policy's linked insurers. This is the SAME rule
 *      `DocumentsTab` uses for the per-row template list — so the
 *      Email Files / WhatsApp Files attachment picker no longer
 *      shows AIG / Zurich / BOC / AXA / Hanson / Dah Sing proposal
 *      forms when the policy is bound to Allied World only.
 *
 * Returning a React hook keeps the caller-side ergonomics identical
 * to what the old dialogs did (`React.useEffect` to fetch on open),
 * while letting us harden the contract in one place.
 */

import * as React from "react";
import type { PdfTemplateMeta } from "@/lib/types/pdf-template";
import type { DeliveryPdfTemplate } from "./types";

type RawTemplateRow = {
  id: number;
  label: string;
  isActive: boolean;
  meta: PdfTemplateMeta | null;
};

type FilterContext = {
  /** Policy + every insurer record linked to this policy (premiums
   *  table, snapshot insurer name, and saved entity links). When the
   *  list is empty we still allow templates with NO insurer
   *  restriction; we only DROP templates that pin themselves to a
   *  set of insurers and the policy isn't in that set. */
  matchingInsurerIds?: number[];
};

/** Pure filter — exported so server callers (or tests) can apply
 *  the same rule without a hook. */
export function filterPolicyVisibleTemplates(
  rows: RawTemplateRow[],
  ctx: FilterContext = {},
): DeliveryPdfTemplate[] {
  const { matchingInsurerIds } = ctx;
  // `matchingInsurerIds` is the set of policy ids that "this policy
  // is allowed to use templates from". When undefined, the caller
  // didn't supply policy context — fall back to "no insurer
  // filtering" for backwards compatibility. When defined (even if
  // empty), templates that pin themselves to specific insurer
  // policy ids must overlap with this set.
  const hasInsurerCtx = Array.isArray(matchingInsurerIds);
  const matchesInsurer = (tplInsurerIds: number[] | undefined) => {
    if (!tplInsurerIds || tplInsurerIds.length === 0) return true;
    if (!hasInsurerCtx) return true;
    return tplInsurerIds.some((id) => matchingInsurerIds!.includes(id));
  };

  return rows
    .filter((r) => {
      if (!r.isActive) return false;
      if (r.meta?.isAgentTemplate) return false;
      const showOn = r.meta?.showOn;
      if (showOn && showOn.length > 0 && !showOn.includes("policy")) return false;
      if (!matchesInsurer(r.meta?.insurerPolicyIds)) return false;
      return true;
    })
    .map((r) => ({ id: r.id, label: r.label }));
}

/**
 * Fetch + filter PDF templates that should appear in a
 * client-facing delivery dialog (Email Files / WhatsApp Files).
 *
 * Re-fetches whenever `enabled` flips to `true` so the dialog gets
 * a fresh list each time the user opens it (admins may have just
 * tweaked a template).
 *
 * Pass `policyId` to scope the list to the templates that match
 * the policy's insurer (proposal forms etc. that are pinned to
 * specific insurance companies are otherwise listed for every
 * policy, which is confusing — see screenshot in the chat thread).
 */
export function usePolicyVisiblePdfTemplates(
  enabled: boolean,
  policyId?: number,
): {
  templates: DeliveryPdfTemplate[];
  loading: boolean;
} {
  const [templates, setTemplates] = React.useState<DeliveryPdfTemplate[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);

    // Fetch templates AND the policy's linked insurers in parallel.
    // The insurer call is best-effort: if it fails we still show
    // the unfiltered list (matches the previous behaviour for
    // admin/global pickers).
    const tplsPromise: Promise<RawTemplateRow[]> = fetch("/api/pdf-templates")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);

    const insurersPromise: Promise<number[] | undefined> =
      typeof policyId === "number" && Number.isFinite(policyId) && policyId > 0
        ? fetch(`/api/policies/${policyId}/linked-insurers`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : { insurerPolicyIds: [] }))
            .then((d: { insurerPolicyIds?: number[] }) => d.insurerPolicyIds ?? [])
            .catch(() => [] as number[])
        : Promise.resolve(undefined);

    Promise.all([tplsPromise, insurersPromise])
      .then(([rows, insurerIds]) => {
        if (cancelled) return;
        // The policy ALWAYS counts as itself when matching insurer
        // restrictions — same rule as DocumentsTab's
        // `matchingIds = [...new Set([detail.policyId, ...insurerIds])]`.
        const matchingInsurerIds =
          insurerIds === undefined
            ? undefined
            : [...new Set([policyId!, ...insurerIds])];
        setTemplates(
          filterPolicyVisibleTemplates(rows, { matchingInsurerIds }),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setTemplates([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, policyId]);

  return { templates, loading };
}
