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

/** Pure filter — exported so server callers (or tests) can apply
 *  the same rule without a hook. */
export function filterPolicyVisibleTemplates(rows: RawTemplateRow[]): DeliveryPdfTemplate[] {
  return rows
    .filter((r) => {
      if (!r.isActive) return false;
      if (r.meta?.isAgentTemplate) return false;
      const showOn = r.meta?.showOn;
      if (showOn && showOn.length > 0 && !showOn.includes("policy")) return false;
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
 */
export function usePolicyVisiblePdfTemplates(enabled: boolean): {
  templates: DeliveryPdfTemplate[];
  loading: boolean;
} {
  const [templates, setTemplates] = React.useState<DeliveryPdfTemplate[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/pdf-templates")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: RawTemplateRow[]) => {
        if (cancelled) return;
        setTemplates(filterPolicyVisibleTemplates(rows));
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
  }, [enabled]);

  return { templates, loading };
}
