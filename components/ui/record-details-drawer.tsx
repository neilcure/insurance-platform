"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { AuditLogPanel, parseAudit } from "@/components/ui/audit-log-panel";
import type { AuditLogPanelProps } from "@/components/ui/audit-log-panel";
import {
  DrawerTabsProvider,
  DrawerTabContent,
  DrawerTabStrip,
  type DrawerTab,
} from "@/components/ui/drawer-tabs";
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
  /**
   * Optional function tabs beyond the default "Overview".
   * All tabs are shown directly in the tab bar.
   * Overview is always the first tab, rendered from `children`.
   */
  functionTabs?: Omit<DrawerTab, "permanent">[];
  /** Custom log panel content — replaces the default AuditLogPanel when provided */
  logContent?: React.ReactNode;
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
  functionTabs,
  logContent,
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

  const overviewContent = (
    <>
      {hasRecentEdit && (
        <div className="mb-3 rounded-md border border-yellow-300/50 bg-yellow-50 p-2 text-[11px] leading-snug text-yellow-800 dark:border-yellow-700/50 dark:bg-yellow-950/40 dark:text-yellow-300">
          Recent changes in the last 7 days are highlighted in yellow.
        </div>
      )}
      {loading ? (
        <div className="text-neutral-500 dark:text-neutral-400">
          Loading...
        </div>
      ) : (
        children
      )}
    </>
  );

  const hasFunctionTabs = functionTabs && functionTabs.length > 0;

  const allTabs: DrawerTab[] = hasFunctionTabs
    ? [
        { id: "overview", label: "Overview", content: overviewContent },
        ...functionTabs,
      ]
    : [];

  const toolbar = (
    <div className="mb-3 flex items-center justify-between">
      {!hasFunctionTabs && <div className="font-medium">Overview</div>}
      <div className="flex items-center gap-2 ml-auto">
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
  );

  const drawerBody = (
    <div
      className="overflow-y-auto p-3 text-sm"
      style={{ maxHeight: "calc(100vh - 52px)" }}
    >
      {toolbar}
      {hasFunctionTabs ? <DrawerTabContent /> : overviewContent}
    </div>
  );

  const wrappedDrawer = hasFunctionTabs ? (
    <DrawerTabsProvider tabs={allTabs} defaultTab="overview">
      <SlideDrawer
        open={drawerOpen}
        onClose={onClose}
        title={title}
        tabStrip={<DrawerTabStrip />}
      >
        {drawerBody}
      </SlideDrawer>
    </DrawerTabsProvider>
  ) : (
    <SlideDrawer open={drawerOpen} onClose={onClose} title={title}>
      {drawerBody}
    </SlideDrawer>
  );

  return (
    <>
      {open ? wrappedDrawer : null}

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
            {logContent ? (
              logContent
            ) : !extraAttributes ? (
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
