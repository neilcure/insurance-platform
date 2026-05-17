"use client";

import * as React from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { DocumentPreview } from "@/components/policies/tabs/DocumentsTab";
import type {
  DocumentTemplateMeta,
  DocumentTemplateRow,
} from "@/lib/types/document-template";
import type { PolicyDetail } from "@/lib/types/policy";
import type { DocumentStatusEntry } from "@/lib/types/accounting";

type RecentPolicy = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
  flowKey: string | null;
  plateNumber?: string | null;
  insuredLabel?: string | null;
};

function recentPolicyPickerLabel(p: RecentPolicy): { short: string; full: string } {
  const bits: string[] = [p.policyNumber];
  if (p.plateNumber && String(p.plateNumber).trim()) bits.push(String(p.plateNumber).trim());
  if (p.insuredLabel && String(p.insuredLabel).trim()) bits.push(String(p.insuredLabel).trim());
  const full = bits.join(" · ");
  const short = full.length > 130 ? `${full.slice(0, 127)}…` : full;
  return { short, full };
}

type SnapshotData = {
  packagesSnapshot?: Record<string, unknown> | null;
  insuredSnapshot?: Record<string, unknown> | null;
};

/**
 * Live preview drawer shown from the document-template editor.
 *
 * Lets the admin pick a real policy, then renders the *current* (unsaved)
 * `meta` against that policy using the exact same `<DocumentPreview />`
 * component that policies use in production — so what the admin sees here
 * is bit-for-bit what end-users will see in the Documents tab.
 *
 * Renders inside the shared `Drawer` from `components/ui/drawer.tsx`,
 * following `docs/drawer-standards.md` (left-slide, fade overlay, escape to
 * close). The drawer is intentionally wider than the standard data drawer
 * because document content needs the room to render at a usable size.
 *
 * Policy data is fetched through the admin-only
 * `/api/admin/policy-preview` endpoint, which returns a `PolicyDetail`-shaped
 * payload identical to the per-policy `/api/policies/[id]` response.
 */
export function DocumentTemplateLivePreview({
  open,
  onOpenChange,
  meta,
  templateLabel,
  templateValue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: DocumentTemplateMeta;
  templateLabel: string;
  templateValue: string;
}) {
  // Inner open flag drives the slide/fade transitions per drawer-standards.md.
  // Mirror the parent's `open` prop, but defer the "true" state by one frame
  // so the entry animation runs.
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setDrawerOpen(false);
      requestAnimationFrame(() => setDrawerOpen(true));
    } else {
      setDrawerOpen(false);
    }
  }, [open]);

  const handleClose = React.useCallback(() => {
    setDrawerOpen(false);
    setTimeout(() => onOpenChange(false), 320);
  }, [onOpenChange]);

  const [policyNum, setPolicyNum] = React.useState("");
  const [recent, setRecent] = React.useState<RecentPolicy[]>([]);
  const [recentLoading, setRecentLoading] = React.useState(false);
  const [detail, setDetail] = React.useState<PolicyDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Active cover-line keys of the currently previewed policy. Lets the
  // preview honour admin-configured `sectionCoverTypes` / `groupCoverTypes`
  // gates so a "Sum Premium (TPO + PD)" group only shows when the policy
  // really has both covers. Loaded alongside the policy detail below.
  const [policyLineKeys, setPolicyLineKeys] = React.useState<Set<string> | null>(null);
  // Policy category slug (e.g. `"tpo"`, `"comp"`, `"tpo_with_od"`)
  // derived from the line-key set against admin-configured
  // `form_options.policy_category` rows. Lets the admin preview honour
  // the new `groupCoverCategories` single-dropdown gate.
  const [policyCategory, setPolicyCategory] = React.useState<string | null>(null);
  // Audience toggle — only meaningful when the template either flags
  // `enableAgentCopy`, is itself an agent template, or has at least one
  // section with `audience: "agent" | "client"`. For client-only templates
  // the toggle is hidden and we always render as client.
  const [previewAudience, setPreviewAudience] = React.useState<"client" | "agent">("client");
  // When ON, sections with no field data are still rendered (with a hint)
  // so the admin can verify the full template layout against any policy.
  // ON by default because the live preview's job is to help admins verify
  // their template structure — silently dropping sections when the chosen
  // policy lacks data caused real confusion (admin thought sections were
  // missing from the template). Untick to see exactly what end-users will
  // get for THIS policy.
  const [showEmptySections, setShowEmptySections] = React.useState(true);

  // Whether the template can render anything different for the agent view.
  // Mirrors the same heuristic used in DocumentsTab so what the admin sees
  // in the preview matches what end-users actually get.
  const supportsAgent = React.useMemo(() => {
    if (meta.isAgentTemplate) return true;
    if (meta.enableAgentCopy) return true;
    return (meta.sections ?? []).some(
      (s) => s.audience === "client" || s.audience === "agent",
    );
  }, [meta.isAgentTemplate, meta.enableAgentCopy, meta.sections]);

  // Reset audience back to "client" whenever the template loses agent support
  // (e.g. admin toggles enableAgentCopy off mid-edit) so the toggle never
  // shows a stale "agent" state without a UI control to flip it back.
  React.useEffect(() => {
    if (!supportsAgent && previewAudience !== "client") {
      setPreviewAudience("client");
    }
  }, [supportsAgent, previewAudience]);

  // Load the "recent policies" list whenever the drawer opens, so the admin
  // can pick a policy without remembering its number. The API omits `clientSet`
  // client-master stubs (insured-only rows) and returns plate + insured hints.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setRecentLoading(true);
      try {
        const res = await fetch("/api/admin/policy-preview", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setRecent(Array.isArray(data?.list) ? data.list : []);
      } catch {
        // best-effort
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadPolicy = React.useCallback(async (numberOrId: string | number) => {
    setLoading(true);
    setError(null);
    try {
      const param = typeof numberOrId === "number"
        ? `id=${numberOrId}`
        : `policyNumber=${encodeURIComponent(numberOrId)}`;
      const res = await fetch(`/api/admin/policy-preview?${param}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to load policy");
      }
      const data = await res.json();
      setDetail(data?.detail ?? null);
      if (data?.detail?.policyNumber) {
        setPolicyNum(data.detail.policyNumber);
      }
      // Also fetch active cover-line keys + policy_category config so
      // the preview honours the cover-types and cover-categories gates.
      // Fire-and-forget — if it fails, the gates simply pass through.
      const pid = data?.detail?.policyId;
      if (typeof pid === "number" && pid > 0) {
        type PolicyCategoryRow = {
          value?: string;
          meta?: { accountingLines?: { key?: string }[] } | null;
        };
        Promise.all([
          fetch(`/api/policies/${pid}/premiums`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : { lines: [] }))
            .then((d: { lines?: { lineKey?: string }[] }) =>
              new Set(
                (d.lines ?? [])
                  .map((l) => String(l.lineKey ?? "").toLowerCase())
                  .filter(Boolean),
              ),
            )
            .catch(() => new Set<string>()),
          fetch(`/api/form-options?groupKey=policy_category`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [] as PolicyCategoryRow[]),
        ])
          .then(([keys, catRows]) => {
            setPolicyLineKeys(keys);
            const rows: PolicyCategoryRow[] = Array.isArray(catRows) ? (catRows as PolicyCategoryRow[]) : [];
            const lineKeyList = Array.from(keys);
            let matched = "";
            for (const row of rows) {
              const lines = row?.meta?.accountingLines;
              if (!Array.isArray(lines) || lines.length === 0) continue;
              const rowKeys = lines.map((l) => String(l?.key ?? "").toLowerCase()).filter(Boolean);
              if (rowKeys.length !== lineKeyList.length) continue;
              const rowKeySet = new Set(rowKeys);
              if (lineKeyList.every((k) => rowKeySet.has(k))) {
                matched = String(row?.value ?? "");
                break;
              }
            }
            setPolicyCategory(matched);
          })
          .catch(() => {
            setPolicyLineKeys(new Set<string>());
            setPolicyCategory("");
          });
      } else {
        setPolicyLineKeys(null);
        setPolicyCategory(null);
      }
    } catch (err) {
      setError((err as Error).message ?? "Failed to load policy");
      setDetail(null);
      setPolicyLineKeys(null);
      setPolicyCategory(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Build a fake DocumentTemplateRow so DocumentPreview can render the
  // unsaved meta without us having to persist the template first.
  const fakeTemplate: DocumentTemplateRow = React.useMemo(
    () => ({
      id: -1,
      groupKey: "document_templates",
      label: templateLabel || "(unsaved template)",
      value: templateValue || "preview",
      sortOrder: 0,
      isActive: true,
      meta,
    }),
    [meta, templateLabel, templateValue],
  );

  const snapshot = React.useMemo<SnapshotData>(
    () => (detail?.extraAttributes ?? {}) as SnapshotData,
    [detail],
  );

  // Synthetic tracking entry so the preview can show what the document-number
  // area will look like once the doc is actually prepared. In production this
  // entry is only created when the admin clicks "Prepare" — until then there
  // is no real number, which is why the live preview used to show an empty
  // doc-no slot. We mirror that production format here using the template's
  // configured `documentPrefix` and add a "(A)" suffix for the agent copy
  // (matches the agent-copy numbering convention in DocumentsTab).
  const previewTrackingEntry = React.useMemo<DocumentStatusEntry | undefined>(() => {
    const prefix = (meta.documentPrefix ?? "").trim();
    if (!prefix) return undefined; // template has no prefix — render as it would in production (no number)
    const isAgentCopy =
      meta.isAgentTemplate || (supportsAgent && previewAudience === "agent");
    const number = `${prefix}-PREVIEW${isAgentCopy ? " (A)" : ""}`;
    return {
      status: "prepared",
      documentNumber: number,
    };
  }, [meta.documentPrefix, meta.isAgentTemplate, supportsAgent, previewAudience]);

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (o) {
          onOpenChange(true);
        } else {
          handleClose();
        }
      }}
      overlayClassName={`transition-opacity duration-300 ${drawerOpen ? "opacity-60" : "opacity-0"}`}
    >
      <DrawerContent
        className={`${drawerOpen ? "translate-x-0" : "-translate-x-full"} left-0 flex w-full flex-col sm:w-[640px] md:w-[820px] lg:w-[960px]`}
      >
        <DrawerHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DrawerTitle>Live Preview</DrawerTitle>
              <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                {templateLabel || "(unsaved template)"}
                {detail ? ` · against ${detail.policyNumber}` : ""}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-8 w-8 shrink-0 p-0"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DrawerHeader>

        {/* Policy picker bar — fixed at top so the preview body scrolls below it. */}
        <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-1 min-w-[200px] flex-col gap-1">
              <Label className="text-xs font-medium">Policy number</Label>
              <div className="flex gap-1">
                <Input
                  value={policyNum}
                  onChange={(e) => setPolicyNum(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && policyNum.trim()) {
                      loadPolicy(policyNum.trim());
                    }
                  }}
                  placeholder="e.g. POL-2025-0001"
                  className="h-8 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => policyNum.trim() && loadPolicy(policyNum.trim())}
                  disabled={loading || !policyNum.trim()}
                  className="gap-1"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  Load
                </Button>
              </div>
            </div>

            {recent.length > 0 && (
              <div className="flex flex-1 min-w-[220px] flex-col gap-1">
                <Label className="text-xs font-medium">Recent policies</Label>
                <select
                  className="h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  value={detail?.policyId ?? ""}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (Number.isFinite(id) && id > 0) loadPolicy(id);
                  }}
                  disabled={recentLoading || loading}
                >
                  <option value="">— pick a recent policy —</option>
                  {recent.map((p) => {
                    const { short, full } = recentPolicyPickerLabel(p);
                    return (
                      <option key={p.policyId} value={p.policyId} title={full}>
                        {short}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* Audience toggle — only meaningful when the template renders
                differently for the agent (has agent-only sections, is an
                agent template, or has Agent Copy enabled). */}
            {supportsAgent && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-medium">View as</Label>
                <div className="inline-flex h-8 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
                  <button
                    type="button"
                    onClick={() => setPreviewAudience("client")}
                    className={`px-3 text-xs font-medium transition-colors ${
                      previewAudience === "client"
                        ? "bg-blue-600 text-white"
                        : "bg-white text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    }`}
                    aria-pressed={previewAudience === "client"}
                  >
                    Client
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewAudience("agent")}
                    className={`px-3 text-xs font-medium transition-colors ${
                      previewAudience === "agent"
                        ? "bg-amber-600 text-white"
                        : "bg-white text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    }`}
                    aria-pressed={previewAudience === "agent"}
                  >
                    Agent
                  </button>
                </div>
              </div>
            )}
          </div>
          {supportsAgent && (
            <div className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              {previewAudience === "agent"
                ? "Showing the Agent copy — agent-only sections (e.g. Agent Premium) are visible; client-only sections are hidden."
                : "Showing the Client copy — client-only sections are visible; agent-only sections are hidden. Switch to Agent above to preview the Agent copy."}
            </div>
          )}
          {/* Show-empty toggle — lets admins verify the layout even when the
              chosen policy lacks data for some fields. Especially useful for
              the agent copy when the policy has no agent-specific values
              (Agent Premium, agent name, etc.) and sections would otherwise
              collapse to nothing. */}
          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
            <input
              type="checkbox"
              checked={showEmptySections}
              onChange={(e) => setShowEmptySections(e.target.checked)}
              className="h-3 w-3"
            />
            <span>
              <strong>Show empty sections</strong> (preview-only) — render
              section headers even when the chosen policy has no data for
              them. Untick to see exactly what end-users will get for this
              policy (production always hides empty sections).
            </span>
          </label>
        </div>

        {/* Scrollable preview body */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          {!detail && !loading && !error && (
            <div className="rounded-md border border-dashed border-neutral-300 px-4 py-12 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              Pick a policy above to preview the rendered document.
              <br />
              Updates to the template (header, sections, fields, formatting) reflect here as soon as you change them.
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 px-4 py-12 text-xs text-neutral-500 dark:text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading policy data…
            </div>
          )}

          {detail && !loading && (
            <DocumentPreview
              template={fakeTemplate}
              detail={detail}
              snapshot={snapshot}
              audience={supportsAgent ? previewAudience : undefined}
              trackingEntry={previewTrackingEntry}
              previewShowEmptySections={showEmptySections}
              policyLineKeys={policyLineKeys ?? undefined}
              policyCategory={policyCategory ?? undefined}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
