"use client";

import * as React from "react";

export type AuditChange = { key: string; from: unknown; to: unknown };
export type AuditEntry = {
  at?: string;
  by?: { id?: number | string; email?: string } | Record<string, unknown>;
  changes?: AuditChange[];
};

function isEmpty(v: unknown): boolean {
  return (
    v === null ||
    typeof v === "undefined" ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

function isMeaningfulChange(from: unknown, to: unknown): boolean {
  if (isEmpty(from) && isEmpty(to)) return false;
  if (typeof from !== "object" && typeof to !== "object")
    return String(from ?? "") !== String(to ?? "");
  try {
    return JSON.stringify(from) !== JSON.stringify(to);
  } catch {
    return String(from ?? "") !== String(to ?? "");
  }
}

function formatWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at || "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

function defaultDisplayValue(v: unknown): string {
  if (isEmpty(v)) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v ?? "");
}

function defaultHumanize(key: string): string {
  return (
    key
      .replace(/__+/g, " ")
      .replace(/_+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || key
  );
}

export type AuditLogPanelProps = {
  audit: AuditEntry[];
  /**
   * Resolve a change key to a human-readable label.
   * Falls back to a built-in humanizer when not provided.
   */
  resolveLabel?: (key: string) => string;
  /**
   * Format a raw value for display. Receives the change key and value.
   * Falls back to a built-in formatter when not provided.
   */
  formatValue?: (key: string, value: unknown) => string;
  /**
   * Optional dedup function: given a change key, return a canonical key.
   * Changes with the same canonical key in one entry are de-duped (last wins).
   */
  dedup?: (key: string) => string;
};

export function AuditLogPanel({
  audit,
  resolveLabel,
  formatValue,
  dedup,
}: AuditLogPanelProps) {
  const label = resolveLabel ?? defaultHumanize;
  const display = formatValue ?? ((_k: string, v: unknown) => defaultDisplayValue(v));

  const entries = audit
    .filter(
      (e): e is Required<AuditEntry> =>
        Array.isArray(e?.changes) && (e.changes?.length ?? 0) > 0,
    )
    .reverse();

  if (entries.length === 0) {
    return (
      <div className="text-neutral-500 dark:text-neutral-400">
        No changes recorded.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((e, idx) => {
        const when = formatWhen(String(e?.at ?? ""));
        const by = (e.by ?? {}) as {
          id?: number | string;
          email?: string;
        };
        const who = by.email || by.id || "Unknown";
        const chRaw = Array.isArray(e?.changes)
          ? (e.changes as AuditChange[])
          : [];
        const ch = chRaw.filter((c) => isMeaningfulChange(c?.from, c?.to));

        const chDedup = (() => {
          if (!dedup) return ch;
          const map = new Map<string, AuditChange>();
          for (const c of ch) {
            const mapKey = dedup(String(c?.key ?? ""));
            if (map.has(mapKey)) map.delete(mapKey);
            map.set(mapKey, c);
          }
          return Array.from(map.values());
        })();

        if (chDedup.length === 0) return null;

        return (
          <div
            key={`audit-${idx}`}
            className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
          >
            <div className="mb-1 flex items-center justify-between">
              <div className="font-medium">{when}</div>
              <div className="text-neutral-500 dark:text-neutral-400">
                {who}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {chDedup.map((c, i) => {
                const lbl = label(String(c.key ?? ""));
                const fromVal = display(String(c.key ?? ""), c.from);
                const toVal =
                  display(String(c.key ?? ""), c.to) ||
                  (isEmpty(c.to) ? "(cleared)" : "");
                return (
                  <div
                    key={`chg-${idx}-${i}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <div className="text-neutral-500 dark:text-neutral-400">
                      {lbl}
                    </div>
                    <div className="max-w-[65%] text-right font-mono">
                      {fromVal ? (
                        <span className="line-through opacity-70">
                          {fromVal}
                        </span>
                      ) : null}
                      {fromVal ? " → " : ""}
                      <span>{toVal}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Parse `_audit` from an `extraAttributes`-style object.
 */
export function parseAudit(
  extra: Record<string, unknown> | null | undefined,
): AuditEntry[] {
  const raw = extra?._audit;
  return Array.isArray(raw)
    ? (raw as unknown[]).map((x) => x as AuditEntry)
    : [];
}
