"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { AuditLogPanel, parseAudit } from "@/components/ui/audit-log-panel";
import type { AuditLogPanelProps } from "@/components/ui/audit-log-panel";
import { Loader2 } from "lucide-react";

export type RecordDetailsDrawerProps = {
  open: boolean;
  drawerOpen: boolean;
  onClose: () => void;
  title: string;
  loading?: boolean;
  extraAttributes?: Record<string, unknown> | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Props forwarded to the audit AuditLogPanel (resolveLabel, formatValue, dedup) */
  auditProps?: Omit<AuditLogPanelProps, "audit">;
  children: React.ReactNode;
};

export function RecordDetailsDrawer({
  open,
  drawerOpen,
  onClose,
  title,
  loading,
  extraAttributes,
  onRefresh,
  refreshing,
  auditProps,
  children,
}: RecordDetailsDrawerProps) {
  const [auditOpen, setAuditOpen] = React.useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = React.useState(false);

  function openAudit() {
    setAuditOpen(true);
    requestAnimationFrame(() => setAuditDrawerOpen(true));
  }
  function closeAudit() {
    setAuditDrawerOpen(false);
    setTimeout(() => setAuditOpen(false), 400);
  }

  const hasRecentEdit = React.useMemo(() => {
    const ts = extraAttributes?._lastEditedAt;
    if (!ts) return false;
    const d = new Date(String(ts));
    const diffMs = Date.now() - d.getTime();
    return diffMs >= 0 && diffMs < 7 * 24 * 60 * 60 * 1000;
  }, [extraAttributes?._lastEditedAt]);

  return (
    <>
      {open ? (
        <SlideDrawer open={drawerOpen} onClose={onClose} title={title}>
          <div
            className="overflow-y-auto p-3 text-sm"
            style={{ maxHeight: "calc(100vh - 52px)" }}
          >
            {hasRecentEdit && (
              <div className="mb-3 rounded-md border border-yellow-300/50 bg-yellow-50 p-2 text-[11px] leading-snug text-yellow-800 dark:border-yellow-700/50 dark:bg-yellow-950/40 dark:text-yellow-300">
                Recent changes in the last 7 days are highlighted in yellow.
              </div>
            )}
            <div className="mb-3 flex items-center justify-between">
              <div className="font-medium">Overview</div>
              <div className="flex items-center gap-2">
                {onRefresh && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onRefresh}
                    disabled={refreshing}
                  >
                    {refreshing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Refresh"
                    )}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={openAudit}>
                  Log
                </Button>
              </div>
            </div>
            {loading ? (
              <div className="text-neutral-500 dark:text-neutral-400">
                Loading...
              </div>
            ) : (
              children
            )}
          </div>
        </SlideDrawer>
      ) : null}

      {auditOpen ? (
        <SlideDrawer
          open={auditDrawerOpen}
          onClose={closeAudit}
          title="Change Log"
          side="right"
          zClass="z-60"
          passthrough
        >
          <div className="p-3 text-xs">
            {!extraAttributes ? (
              <div className="text-neutral-500 dark:text-neutral-400">
                No details.
              </div>
            ) : (
              <AuditLogPanel
                audit={parseAudit(extraAttributes)}
                {...auditProps}
              />
            )}
          </div>
        </SlideDrawer>
      ) : null}
    </>
  );
}
