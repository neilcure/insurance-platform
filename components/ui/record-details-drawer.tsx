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
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Loader2 } from "lucide-react";

type StatusHistoryEntry = {
  status: string;
  changedAt: string;
  changedBy?: string;
  note?: string;
};

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
  /** Status history entries shown at the top of the Log drawer */
  statusHistory?: StatusHistoryEntry[];
  /** Map status value → display label for status history badges */
  statusLabels?: Record<string, string>;
  /** Z-index class for stacked/nested drawers */
  zClass?: string;
  /** When true, backdrop doesn't block pointer events behind it */
  passthrough?: boolean;
  /** Which side the drawer opens from */
  side?: "left" | "right";
  /** Initial tab id when function tabs are enabled (defaults to "overview") */
  initialTabId?: string;
  children: React.ReactNode;
};

function StatusHistoryCollapsible({ entries, statusLabels }: { entries: StatusHistoryEntry[]; statusLabels?: Record<string, string> }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Status History</span>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">{entries.length}</Badge>
            <ChevronRight className={`h-3.5 w-3.5 text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`} />
          </div>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {entries.map((entry, idx) => (
            <div key={idx} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Badge variant="outline" className="text-[10px] whitespace-normal wrap-break-word max-w-full">
                  {statusLabels?.[entry.status] ?? entry.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </Badge>
                {entry.note && (
                  <div className="mt-0.5 text-neutral-500 dark:text-neutral-400 wrap-break-word">{entry.note}</div>
                )}
              </div>
              <div className="shrink-0 text-right text-neutral-400 dark:text-neutral-500">
                <div>{new Date(entry.changedAt).toLocaleDateString()}</div>
                {entry.changedBy && <div className="truncate max-w-[120px]">{entry.changedBy}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  statusHistory,
  statusLabels,
  zClass,
  passthrough,
  side,
  initialTabId,
  children,
}: RecordDetailsDrawerProps) {
  const [auditOpen, setAuditOpen] = React.useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = React.useState(false);
  const [nowMs, setNowMs] = React.useState<number | null>(null);

  React.useEffect(() => {
    setNowMs(Date.now());
  }, [extraAttributes?._lastEditedAt]);

  function openAudit() {
    setAuditOpen(true);
    requestAnimationFrame(() => setAuditDrawerOpen(true));
  }
  function closeAudit() {
    setAuditDrawerOpen(false);
    setTimeout(() => setAuditOpen(false), 400);
  }

  const hasRecentEdit = React.useMemo(() => {
    if (nowMs === null) return false;
    const ts = extraAttributes?._lastEditedAt;
    if (!ts) return false;
    const d = new Date(String(ts));
    const diffMs = nowMs - d.getTime();
    return diffMs >= 0 && diffMs < 7 * 24 * 60 * 60 * 1000;
  }, [extraAttributes?._lastEditedAt, nowMs]);

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
    <DrawerTabsProvider tabs={allTabs} defaultTab={initialTabId || "overview"}>
      <SlideDrawer
        open={drawerOpen}
        onClose={onClose}
        title={title}
        tabStrip={<DrawerTabStrip />}
        {...(side ? { side } : {})}
        {...(zClass ? { zClass } : {})}
        {...(passthrough ? { passthrough } : {})}
      >
        {drawerBody}
      </SlideDrawer>
    </DrawerTabsProvider>
  ) : (
    <SlideDrawer
      open={drawerOpen}
      onClose={onClose}
      title={title}
      {...(side ? { side } : {})}
      {...(zClass ? { zClass } : {})}
      {...(passthrough ? { passthrough } : {})}
    >
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
          zClass={zClass ? "z-[70]" : "z-60"}
          passthrough
        >
          <div className="p-3 text-xs space-y-4">
            {statusHistory && statusHistory.length > 0 && (
              <StatusHistoryCollapsible entries={statusHistory} statusLabels={statusLabels} />
            )}
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
