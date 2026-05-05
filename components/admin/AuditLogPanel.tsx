"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCheck, Loader2 } from "lucide-react";
import { usePagination } from "@/lib/pagination/use-pagination";
import { Pagination } from "@/components/ui/pagination";

type AuditEntry = {
  id: number;
  userId: number | null;
  userType: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  isRead: boolean;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
};

const USER_TYPE_LABELS: Record<string, string> = {
  admin: "Admin",
  agent: "Agent",
  accounting: "Accounting",
  internal_staff: "Staff",
  direct_client: "Client",
  service_provider: "Service Provider",
};

function humanizeUserType(t: string | null): string {
  if (!t) return "Unknown";
  return USER_TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function humanizeKey(key: string): string {
  return key
    .replace(/^(insured__|contactinfo__|insured_|contactinfo_)/, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function AuditLogPanel() {
  const {
    rows: entries,
    total,
    page,
    pageSize,
    loading,
    setPage,
    setPageSize,
    refresh,
    patchRow,
  } = usePagination<AuditEntry>({
    url: "/api/admin/audit-log",
    scope: "admin-audit-log",
    initialPageSize: 30,
  });

  async function markAllRead() {
    try {
      await fetch("/api/admin/audit-log", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      // Update visible rows in place; the badge in the sidebar listens
      // to "audit:changed" and will refetch the global unread count.
      entries.forEach((entry, idx) => {
        if (!entry.isRead) patchRow(idx, { ...entry, isRead: true });
      });
      window.dispatchEvent(new Event("audit:changed"));
      toast.success("All marked as read");
      // Mark-all-read is a global action — refresh to reflect any rows on
      // other pages that are now read too.
      refresh();
    } catch {
      toast.error("Failed to mark as read");
    }
  }

  const unreadCount = entries.filter((e) => !e.isRead).length;

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (total === 0) {
    return (
      <p className="py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No activity yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-600 dark:text-neutral-400">
            {unreadCount} unread on this page
          </span>
          <Button size="sm" variant="outline" onClick={markAllRead} title="Mark all read (across every page)">
            <CheckCheck className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Mark all read</span>
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {entries.map((e) => (
          <div
            key={e.id}
            className={`rounded-md border p-3 text-sm ${
              e.isRead
                ? "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                : "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                {!e.isRead && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                <span className="font-medium">
                  {e.userName || e.userEmail || "Unknown"}
                </span>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
                  {humanizeUserType(e.userType)}
                </span>
              </div>
              <span className="text-xs text-neutral-400">{timeAgo(e.createdAt)}</span>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-1">
              {e.action === "profile_update" ? "Updated profile" : e.action}
              {e.entityType === "client" ? " (Client)" : ""}
            </p>
            {e.changes && Object.keys(e.changes).length > 0 && (
              <div className="mt-1 space-y-0.5">
                {Object.entries(e.changes).map(([key, diff]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300 min-w-[100px]">
                      {humanizeKey(key)}:
                    </span>
                    <span className="text-red-500 line-through">{formatValue(diff.from)}</span>
                    <span className="text-neutral-400">&rarr;</span>
                    <span className="text-green-600 dark:text-green-400">{formatValue(diff.to)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        itemNoun="entries"
      />
    </div>
  );
}
