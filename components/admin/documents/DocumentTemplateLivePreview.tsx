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

type RecentPolicy = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
  flowKey: string | null;
};

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

  // Load the "recent policies" list whenever the drawer opens, so the admin
  // can pick a policy without remembering its number.
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
    } catch (err) {
      setError((err as Error).message ?? "Failed to load policy");
      setDetail(null);
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
                  {recent.map((p) => (
                    <option key={p.policyId} value={p.policyId}>
                      {p.policyNumber}
                      {p.flowKey ? ` · ${p.flowKey}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
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
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
