"use client";

import * as React from "react";
import type { PolicyDetail } from "@/lib/types/policy";
import { normalizeFieldKey, isHiddenPackage } from "@/lib/utils";
import { ClientLinkedPolicies } from "@/components/policies/ClientLinkedPolicies";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type FieldMeta = {
  labels: Record<string, string>;
  sortOrders: Record<string, number>;
  groupOrders: Record<string, number>;
  groupNames: Record<string, string>;
  optionLabels: Record<string, Record<string, string>>;
  inputTypes: Record<string, string>;
  currencyCodes: Record<string, string>;
  formattingMeta: Record<string, {
    labelCase?: "original" | "upper" | "lower" | "title";
    valueCase?: "original" | "upper" | "lower" | "title";
    numberFormat?: "plain" | "currency" | "percent";
    currencyCode?: string;
    decimals?: number;
    booleanLabels?: { true?: string; false?: string };
  }>;
};

const toKey = (v: unknown) => String(v ?? "").trim();
const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const normalizeKey = normalizeFieldKey;

function registerChildLabels(
  parentKey: string,
  parentLabel: string,
  childrenArr: Array<any>,
  keyPrefix: string,
  meta: FieldMeta,
  groupOrder: number,
  groupName: string,
  parentOrder: number,
) {
  childrenArr.forEach((child: any, idx: number) => {
    const childKey = `${parentKey}__${keyPrefix}${idx}`;
    const childInputType = typeof child?.inputType === "string" ? child.inputType : child?.repeatable ? "repeatable" : "";
    const childLabelRaw = toKey(child?.label);
    const childLabel = childLabelRaw && childLabelRaw.toLowerCase() !== "details" ? childLabelRaw : "Details";
    const isRepeatable = childInputType === "repeatable";
    const displayLabel = isRepeatable ? parentLabel : `${parentLabel} — ${childLabel}`;
    meta.labels[childKey] = displayLabel;
    meta.groupOrders[childKey] = groupOrder;
    meta.groupNames[childKey] = groupName;
    meta.sortOrders[childKey] = parentOrder;
    if (childInputType) meta.inputTypes[childKey] = childInputType;
    const cc = typeof child?.currencyCode === "string" ? child.currencyCode.trim() : "";
    if (cc) meta.currencyCodes[childKey] = cc;
    if (Array.isArray(child?.options)) {
      const optMap: Record<string, string> = {};
      for (const o of child.options as Array<{ value?: unknown; label?: unknown }>) {
        const ov = toKey(o?.value ?? o?.label);
        const ol = toKey(o?.label ?? o?.value);
        if (ov) optMap[ov] = ol || ov;
      }
      if (Object.keys(optMap).length > 0) meta.optionLabels[childKey] = optMap;
    }
    // Nested boolean branch children
    const bc = child?.booleanChildren as { true?: any[]; false?: any[] } | undefined;
    if (bc) {
      for (const [br, arr] of [["true", bc.true], ["false", bc.false]] as Array<[string, any[] | undefined]>) {
        if (!Array.isArray(arr)) continue;
        registerChildLabels(childKey, displayLabel, arr, `${br}__bc`, meta, groupOrder, groupName, parentOrder);
      }
    }
  });
}

async function loadFieldMeta(packageNames: string[]): Promise<{
  pkgMeta: Record<string, FieldMeta>;
  packageLabels: Record<string, string>;
  packageSortOrders: Record<string, number>;
  categoryLabels: Record<string, Record<string, string>>;
}> {
  const ts = Date.now();
  const [packagesRes, ...fieldAndCatResults] = await Promise.all([
    fetch(`/api/form-options?groupKey=packages&_t=${ts}`, { cache: "no-store" }).then(r => r.ok ? r.json() : []).catch(() => []),
    ...packageNames.flatMap(pkg => [
      fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}&_t=${ts}`, { cache: "no-store" }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_category`)}&_t=${ts}`, { cache: "no-store" }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]),
  ]);

  const packageLabels: Record<string, string> = {};
  const packageSortOrders: Record<string, number> = {};
  if (Array.isArray(packagesRes)) {
    for (const row of packagesRes as Array<{ value?: unknown; label?: unknown; sortOrder?: unknown }>) {
      const key = toKey(row?.value);
      if (!key) continue;
      packageLabels[key] = toKey(row?.label) || key;
      packageSortOrders[key] = toNum(row?.sortOrder);
    }
  }

  const pkgMeta: Record<string, FieldMeta> = {};
  const categoryLabels: Record<string, Record<string, string>> = {};

  packageNames.forEach((pkg, idx) => {
    const fieldRows = fieldAndCatResults[idx * 2] as Array<{ value?: unknown; label?: unknown; sortOrder?: unknown; meta?: unknown }> ?? [];
    const catRows = fieldAndCatResults[idx * 2 + 1] as Array<{ value?: unknown; label?: unknown }> ?? [];

    const fm: FieldMeta = {
      labels: {}, sortOrders: {}, groupOrders: {}, groupNames: {},
      optionLabels: {}, inputTypes: {}, currencyCodes: {}, formattingMeta: {},
    };

    for (const row of Array.isArray(fieldRows) ? fieldRows : []) {
      const key = toKey(row?.value);
      if (!key) continue;
      const parentLabel = toKey(row?.label) || key;
      fm.labels[key] = parentLabel;
      fm.sortOrders[key] = toNum((row as any)?.sortOrder);

      const m = (row?.meta ?? null) as Record<string, unknown> | null;
      const groupName = typeof m?.group === "string" ? m.group : "";
      const groupOrder = toNum(m?.groupOrder);
      const inputType = typeof m?.inputType === "string" ? String(m.inputType) : "";

      fm.groupNames[key] = groupName;
      fm.groupOrders[key] = groupOrder;
      if (inputType) fm.inputTypes[key] = inputType;
      const cc = typeof m?.currencyCode === "string" ? String(m.currencyCode).trim() : "";
      if (cc) fm.currencyCodes[key] = cc;

      // Formatting meta
      fm.formattingMeta[key] = {
        labelCase: m?.labelCase as any,
        valueCase: m?.valueCase as any,
        numberFormat: m?.numberFormat as any,
        currencyCode: cc || undefined,
        decimals: Number.isFinite(Number(m?.decimals)) ? Number(m!.decimals) : undefined,
        booleanLabels: m?.booleanLabels as any,
      };

      // Select option labels + children
      if (Array.isArray(m?.options)) {
        const opts = m.options as Array<{ value?: unknown; label?: unknown; children?: unknown }>;
        const optMap: Record<string, string> = {};
        for (const o of opts) {
          const ov = toKey(o?.value ?? o?.label);
          const ol = toKey(o?.label ?? o?.value);
          if (ov) optMap[ov] = ol || ov;
        }
        if (Object.keys(optMap).length > 0) fm.optionLabels[key] = optMap;

        for (const o of opts) {
          const optVal = toKey(o?.value ?? "");
          const children = Array.isArray(o?.children) ? o.children as any[] : [];
          if (children.length > 0) {
            registerChildLabels(key, parentLabel, children, `opt_${optVal}__c`, fm, groupOrder, groupName, fm.sortOrders[key] ?? 0);
          }
        }
      }

      // Boolean children
      const bc = (m as any)?.booleanChildren as { true?: any[]; false?: any[] } | undefined;
      if (bc) {
        for (const [br, arr] of [["true", bc.true], ["false", bc.false]] as Array<[string, any[] | undefined]>) {
          if (!Array.isArray(arr)) continue;
          registerChildLabels(key, parentLabel, arr, `${br}__c`, fm, groupOrder, groupName, fm.sortOrders[key] ?? 0);
        }
      }
    }

    pkgMeta[pkg] = fm;

    const catMap: Record<string, string> = {};
    for (const row of Array.isArray(catRows) ? catRows : []) {
      const key = toKey(row?.value);
      if (!key) continue;
      catMap[key] = toKey(row?.label) || key;
    }
    categoryLabels[pkg] = catMap;
  });

  return { pkgMeta, packageLabels, packageSortOrders, categoryLabels };
}

function stripPkgPrefix(key: string, pkgName?: string): string {
  if (pkgName) {
    const prefixes = [`${pkgName}__`, `${pkgName}_`];
    for (const p of prefixes) {
      if (key.startsWith(p) && key.length > p.length) return key.slice(p.length);
    }
  }
  const dblIdx = key.indexOf("__");
  if (dblIdx > 0 && dblIdx < key.length - 2) return key.slice(dblIdx + 2);
  return key;
}

function resolveKey(key: string, labels: Record<string, string>, pkgName?: string): string {
  if (labels[key]) return key;
  const stripped = key.replace(/^_+/, "");
  if (stripped !== key && labels[stripped]) return stripped;
  const base = stripPkgPrefix(key, pkgName);
  if (base !== key && labels[base]) return base;
  const nk = normalizeKey(key);
  const match = Object.keys(labels).find(k => normalizeKey(k) === nk);
  if (match) return match;
  const nkBase = normalizeKey(base);
  const baseMatch = Object.keys(labels).find(k => normalizeKey(k) === nkBase);
  return baseMatch ?? base;
}

function humanizeFieldKey(key: string, labels: Record<string, string>, pkgName?: string): string {
  let s = key.replace(/^_+/, "");
  s = s.replace(/__opt_[^_]+/g, "");
  s = s.replace(/__c\d+/g, "");
  s = s.replace(/__bc\d+/g, "");
  s = s.replace(/__(true|false)/g, "");
  const base = stripPkgPrefix(s, pkgName);
  const baseNorm = normalizeKey(base);
  const baseMatch = Object.keys(labels).find(k => normalizeKey(k) === baseNorm);
  if (baseMatch) return labels[baseMatch] ?? baseMatch;
  const parentToken = normalizeKey(s.split("__")[0] ?? s);
  const parentMatch = Object.keys(labels).find(k => normalizeKey(k) === parentToken);
  if (parentMatch) return labels[parentMatch] ?? parentMatch;
  let display = base.replace(/__+/g, " ").replace(/_+/g, " ");
  display = display.replace(/([a-z])([A-Z])/g, "$1 $2");
  return display.replace(/\b\w/g, c => c.toUpperCase()).trim() || key;
}

function applyCase(text: string, mode?: "original" | "upper" | "lower" | "title") {
  switch (mode) {
    case "upper": return text.toUpperCase();
    case "lower": return text.toLowerCase();
    case "title": return text.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    default: return text;
  }
}

function formatCurrency(n: number, code: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code.toUpperCase() }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

function formatFieldValue(
  value: unknown,
  type: string,
  optionMap: Record<string, string>,
  fmtMeta?: FieldMeta["formattingMeta"][string],
): string {
  if (type === "select") return optionMap[String(value ?? "")] ?? String(value ?? "");
  if (type === "multi_select") {
    const arr = Array.isArray(value) ? value : String(value ?? "").split(",").map(s => s.trim()).filter(Boolean);
    return arr.map(v => optionMap[String(v)] ?? String(v)).join(", ");
  }
  if (type === "boolean") {
    const t = fmtMeta?.booleanLabels?.true ?? "Yes";
    const f = fmtMeta?.booleanLabels?.false ?? "No";
    return (value === true || value === "true") ? t : f;
  }
  if (type === "percent") {
    const n = typeof value === "number" ? value : Number(value as any);
    if (!Number.isFinite(n)) return String(value ?? "");
    const d = typeof fmtMeta?.decimals === "number" ? fmtMeta.decimals : 2;
    return `${n.toFixed(d)}%`;
  }
  if (type === "currency" || type === "number") {
    const n = typeof value === "number" ? value : Number(value as any);
    if (!Number.isFinite(n)) return String(value ?? "");
    if (type === "currency") {
      const code = (fmtMeta?.currencyCode || "HKD").toUpperCase();
      const decimals = fmtMeta?.decimals;
      if (typeof decimals === "number") {
        try {
          return new Intl.NumberFormat(undefined, {
            style: "currency", currency: code,
            minimumFractionDigits: decimals, maximumFractionDigits: decimals,
          }).format(n);
        } catch { return n.toFixed(decimals); }
      }
      return formatCurrency(n, code);
    }
    if (fmtMeta?.numberFormat === "currency") {
      return formatCurrency(n, (fmtMeta.currencyCode || "HKD"));
    }
    if (fmtMeta?.numberFormat === "percent") {
      const d = typeof fmtMeta.decimals === "number" ? fmtMeta.decimals : 2;
      return `${n.toFixed(d)}%`;
    }
    return typeof fmtMeta?.decimals === "number" ? n.toFixed(fmtMeta.decimals) : String(n);
  }
  if (typeof value === "string") return applyCase(value, fmtMeta?.valueCase);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

type StructuredPkg = { category?: string | number | boolean; values?: Record<string, unknown> };
const isStructuredPkg = (p: unknown): p is StructuredPkg => {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return "values" in o || "category" in o;
};

function PackageSection({
  pkgName,
  pkg,
  meta,
  packageLabel,
  categoryLabel,
  recentKeys,
  onEdit,
}: {
  pkgName: string;
  pkg: unknown;
  meta: FieldMeta;
  packageLabel: string;
  categoryLabel?: string;
  recentKeys?: Set<string>;
  onEdit?: () => void;
}) {
  const values: Record<string, unknown> = isStructuredPkg(pkg) ? (pkg as StructuredPkg).values ?? {} : (pkg as Record<string, unknown>) ?? {};
  const category = isStructuredPkg(pkg) ? (pkg as StructuredPkg).category : undefined;
  const displayCategoryLabel = category
    ? (categoryLabel ?? String(category))
    : undefined;

  const resolve = (key: string) => resolveKey(key, meta.labels, pkgName);
  const label = (key: string) => {
    const rk = resolve(key);
    const registered = meta.labels[rk];
    const raw = registered ?? humanizeFieldKey(key, meta.labels, pkgName);
    return applyCase(raw, meta.formattingMeta[rk]?.labelCase);
  };
  const getType = (key: string) => meta.inputTypes[resolve(key)] ?? "";
  const getOptMap = (key: string) => meta.optionLabels[resolve(key)] ?? {};
  const getFmt = (key: string) => meta.formattingMeta[resolve(key)];

  const isRecentKey = (k: string): boolean => {
    if (!recentKeys || recentKeys.size === 0) return false;
    if (recentKeys.has(k)) return true;
    const stripped = stripPkgPrefix(k, pkgName);
    if (recentKeys.has(stripped)) return true;
    const nk = normalizeKey(k);
    for (const rk of recentKeys) {
      if (normalizeKey(rk) === nk) return true;
    }
    return false;
  };
  const recentCls = "text-yellow-600 dark:text-yellow-400";

  const kvsRaw = Object.entries(values).filter(([k, v]) => {
    if (v === null || typeof v === "undefined") return false;
    const t = getType(k);
    if (t === "boolean") return !(v === false || v === "false");
    if (typeof v === "boolean" && v === false) return false;
    return String(v).trim() !== "";
  });

  const kvsSorted = kvsRaw.sort(([aK], [bK]) => {
    const aR = resolve(aK), bR = resolve(bK);
    const ag = toNum(meta.groupOrders[aR]), bg = toNum(meta.groupOrders[bR]);
    if (ag !== bg) return ag - bg;
    const agn = meta.groupNames[aR] ?? "", bgn = meta.groupNames[bR] ?? "";
    if (agn !== bgn) return agn.localeCompare(bgn, undefined, { sensitivity: "base" });
    const ao = toNum(meta.sortOrders[aR]), bo = toNum(meta.sortOrders[bR]);
    if (ao !== bo) return ao - bo;
    return (meta.labels[aR] ?? aR).localeCompare(meta.labels[bR] ?? bR, undefined, { sensitivity: "base" });
  });

  const seen = new Set<string>();
  const kvs: Array<[string, unknown]> = [];
  for (const [k, v] of kvsSorted) {
    const norm = normalizeKey(resolve(k));
    if (seen.has(norm)) continue;
    seen.add(norm);
    kvs.push([k, v]);
  }

  if (kvs.length === 0) return null;

  return (
    <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-medium">{packageLabel}</div>
        <div className="flex items-center gap-2">
          {displayCategoryLabel ? (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Category: {displayCategoryLabel}</span>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1">
        {(() => {
          const childOptPattern = /__opt_[^_]+__c\d+$/;
          const parentMultiSelectKeys = new Set<string>();
          for (const [k] of kvs) {
            const type = getType(k);
            if (type === "multi_select" && !childOptPattern.test(k)) {
              parentMultiSelectKeys.add(k);
            }
          }
          const renderedChildKeys = new Set<string>();
          for (const parentKey of parentMultiSelectKeys) {
            for (const [ck] of kvs) {
              if (ck.startsWith(`${parentKey}__opt_`) && childOptPattern.test(ck)) {
                renderedChildKeys.add(ck);
              }
            }
          }

          return kvs.map(([k, v]) => {
            if (renderedChildKeys.has(k)) return null;

            const rk = resolve(k);
            const fieldLabel = label(k);
            const type = getType(k);
            const fmt = getFmt(k);
            const recent = isRecentKey(k);

            if (type === "repeatable" && Array.isArray(v)) {
              const items = (v as unknown[]).filter(it => it && typeof it === "object") as Array<Record<string, unknown>>;
              const pickKey = (obj: Record<string, unknown>, pri: string[]) => {
                const keys = Object.keys(obj);
                return keys.find(kk => pri.includes(kk.toLowerCase())) ?? keys.find(kk => pri.some(p => kk.toLowerCase().includes(p)));
              };
              const code = (fmt?.currencyCode || "HKD").toUpperCase();
              const names: string[] = [];
              const prices: string[] = [];
              for (const it of items) {
                const nk = pickKey(it, ["name", "tname", "label", "title", "item", "desc"]) ?? Object.keys(it)[0];
                const pk = pickKey(it, ["price", "aprice", "amount", "cost", "value"]);
                if (nk) names.push(String(it[nk] ?? ""));
                if (pk) {
                  const num = Number(it[pk]);
                  prices.push(Number.isFinite(num) ? formatCurrency(num, code) : String(it[pk] ?? ""));
                }
              }
              return (
                <React.Fragment key={k}>
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <div className="text-neutral-500 dark:text-neutral-400">{`${fieldLabel} — Name`}</div>
                    <div className={`max-w-[60%] wrap-break-word font-mono text-right ${recent ? recentCls : ""}`}>{names.filter(Boolean).join(", ")}</div>
                  </div>
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <div className="text-neutral-500 dark:text-neutral-400">{`${fieldLabel} — Price`}</div>
                    <div className={`max-w-[60%] wrap-break-word font-mono text-right ${recent ? recentCls : ""}`}>{prices.filter(Boolean).join(", ")}</div>
                  </div>
                </React.Fragment>
              );
            }

            if (type === "multi_select") {
              const arr = Array.isArray(v) ? v : String(v ?? "").split(",").map(s => s.trim()).filter(Boolean);
              const optMap = getOptMap(k);
              const groups: { label: string; children: string[] }[] = [];
              for (const raw of arr) {
                const val = String(raw);
                const parentLabel = optMap[val] ?? val;
                const children: string[] = [];
                for (const [ck, cv] of kvs) {
                  const optPrefix = `${k}__opt_${val}__c`;
                  if (ck.startsWith(optPrefix)) {
                    const childArr = Array.isArray(cv) ? cv : String(cv ?? "").split(",").map(s => s.trim()).filter(Boolean);
                    const childOptMap = getOptMap(ck);
                    for (const cv2 of childArr) {
                      children.push(childOptMap[String(cv2)] ?? String(cv2));
                    }
                  }
                }
                groups.push({ label: parentLabel, children });
              }
              if (groups.length > 0) {
                return <MultiSelectViewRow key={k} fieldLabel={fieldLabel} groups={groups} />;
              }
            }

            const valueText = formatFieldValue(v, type, getOptMap(k), fmt);
            return (
              <div key={k} className="flex items-start justify-between gap-3 text-xs">
                <div className="text-neutral-500 dark:text-neutral-400">{fieldLabel}</div>
                <div className={`max-w-[60%] wrap-break-word font-mono text-right ${recent ? recentCls : ""}`}>{valueText}</div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

function MultiSelectViewRow({ fieldLabel, groups }: {
  fieldLabel: string;
  groups: { label: string; children: string[] }[];
}) {
  const [open, setOpen] = React.useState(false);
  const hasChildren = groups.some(g => g.children.length > 0);
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <div className="text-neutral-500 dark:text-neutral-400">{fieldLabel}</div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        View
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <div className="flex items-start justify-between">
            <DialogHeader>
              <DialogTitle>{fieldLabel}</DialogTitle>
            </DialogHeader>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="space-y-3">
            {groups.map((g, idx) => (
              <div key={idx}>
                <div className={`text-sm ${hasChildren ? "font-medium" : ""}`}>{g.label}</div>
                {g.children.length > 0 && (
                  <ul className="mt-1 space-y-1 pl-4">
                    {g.children.map((child, cIdx) => (
                      <li key={cIdx} className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                        <span className="mt-0.5 shrink-0">&ndash;</span>
                        <span>{child}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PolicySnapshotView({ detail, entityLabel, onEditPackage }: {
  detail: PolicyDetail;
  entityLabel?: string;
  onEditPackage?: (pkgName: string, pkgLabel: string, values: Record<string, unknown>) => void;
}) {
  const [meta, setMeta] = React.useState<{
    pkgMeta: Record<string, FieldMeta>;
    packageLabels: Record<string, string>;
    packageSortOrders: Record<string, number>;
    categoryLabels: Record<string, Record<string, string>>;
  } | null>(null);

  const snap = (detail.extraAttributes ?? {}) as Record<string, unknown>;
  const pkgs = (snap.packagesSnapshot ?? {}) as Record<string, unknown>;
  const insuredSnap = (snap.insuredSnapshot ?? null) as Record<string, unknown> | null;

  const isClientRecord = React.useMemo(() => {
    const fk = String(snap.flowKey ?? "").toLowerCase();
    return fk.includes("client");
  }, [snap.flowKey]);

  const allPkgs = React.useMemo(() => {
    const merged = { ...pkgs };
    if (!insuredSnap || typeof insuredSnap !== "object") return merged;
    const insuredValues: Record<string, unknown> = {};
    const contactValues: Record<string, unknown> = {};
    let insuredCategory = "";
    for (const [k, v] of Object.entries(insuredSnap)) {
      if (v === null || typeof v === "undefined" || String(v).trim() === "") continue;
      const lower = k.toLowerCase();
      if (lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")) {
        contactValues[k] = v;
      } else if (lower === "insuredtype" || lower === "insured__category") {
        insuredCategory = String(v).trim();
      } else if (lower.startsWith("insured_") || lower.startsWith("insured__")) {
        insuredValues[k] = v;
      }
    }

    const normForMerge = (k: string) => k.toLowerCase().replace(/_+/g, "");
    const mergeOverride = (target: Record<string, unknown>, source: Record<string, unknown>) => {
      const result = { ...target };
      const targetNorms = new Map<string, string>();
      for (const k of Object.keys(result)) targetNorms.set(normForMerge(k), k);
      for (const [k, v] of Object.entries(source)) {
        const existingKey = targetNorms.get(normForMerge(k));
        if (existingKey) {
          result[existingKey] = v;
        } else {
          result[k] = v;
        }
      }
      return result;
    };

    if (Object.keys(insuredValues).length > 0) {
      if (merged["insured"] && typeof merged["insured"] === "object") {
        const existing = merged["insured"] as Record<string, unknown>;
        const isStruct = "values" in existing || "category" in existing;
        if (isStruct) {
          const vals = (existing as { values?: Record<string, unknown> }).values ?? {};
          merged["insured"] = {
            ...existing,
            values: mergeOverride(vals, insuredValues),
            ...(insuredCategory ? { category: insuredCategory } : {}),
          };
        } else {
          merged["insured"] = mergeOverride(existing, insuredValues);
        }
      } else {
        merged["insured"] = insuredCategory
          ? { category: insuredCategory, values: insuredValues }
          : insuredValues;
      }
    }
    if (Object.keys(contactValues).length > 0) {
      if (merged["contactinfo"] && typeof merged["contactinfo"] === "object") {
        const existing = merged["contactinfo"] as Record<string, unknown>;
        const isStruct = "values" in existing || "category" in existing;
        if (isStruct) {
          const vals = (existing as { values?: Record<string, unknown> }).values ?? {};
          merged["contactinfo"] = { ...existing, values: mergeOverride(vals, contactValues) };
        } else {
          merged["contactinfo"] = mergeOverride(existing, contactValues);
        }
      } else {
        merged["contactinfo"] = contactValues;
      }
    }
    return merged;
  }, [pkgs, insuredSnap]);

  const pkgNames = React.useMemo(() => Object.keys(allPkgs), [allPkgs]);

  const recentKeys = React.useMemo(() => {
    const keys = new Set<string>();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    type AuditEntry = { at?: string; changes?: Array<{ key: string }> };
    const audit = Array.isArray(snap._audit) ? (snap._audit as AuditEntry[]) : [];
    for (const entry of audit) {
      const at = new Date(String(entry?.at ?? "")).getTime();
      if (!Number.isFinite(at) || now - at > sevenDaysMs || now - at < 0) continue;
      for (const c of Array.isArray(entry?.changes) ? entry.changes! : []) {
        if (c?.key) keys.add(c.key);
      }
    }
    return keys;
  }, [snap._audit]);

  React.useEffect(() => {
    if (pkgNames.length === 0) { setMeta(null); return; }
    let cancelled = false;
    loadFieldMeta(pkgNames).then(result => { if (!cancelled) setMeta(result); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pkgNames.join(",")]);

  const packageLabels = meta?.packageLabels ?? {};

  // Insurance type detection
  const insuranceType = React.useMemo(() => {
    try {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const knownByLabel: Record<string, string> = {
        [normalize("Vehicle Insurance")]: "Vehicle Insurance",
        [normalize("Employee Compensation")]: "Employee Compensation",
        [normalize("Liability Insurance")]: "Liability Insurance",
      };
      const knownByPkg: Array<{ match: (s: string) => boolean; label: string }> = [
        { match: s => ["vehicleinfo", "vehicle", "car", "auto"].includes(s), label: "Vehicle Insurance" },
        { match: s => ["ecinfo", "employeecompensation", "ec"].includes(s), label: "Employee Compensation" },
        { match: s => ["liability", "liabilityinfo"].includes(s), label: "Liability Insurance" },
      ];
      for (const [pkgName, pkg] of Object.entries(pkgs)) {
        const lbl = packageLabels[pkgName];
        if (lbl) {
          const k = normalize(lbl);
          if (knownByLabel[k]) {
            const vals = pkg && typeof pkg === "object"
              ? ("values" in (pkg as any) ? (pkg as any).values ?? pkg : pkg) as Record<string, unknown>
              : {};
            if (Object.values(vals).some(v => v !== null && typeof v !== "undefined" && String(v).trim() !== "")) return knownByLabel[k];
          }
        }
        const pn = normalize(pkgName);
        for (const rule of knownByPkg) {
          if (rule.match(pn)) {
            const vals = pkg && typeof pkg === "object"
              ? ("values" in (pkg as any) ? (pkg as any).values ?? pkg : pkg) as Record<string, unknown>
              : {};
            if (Object.values(vals).some(v => v !== null && typeof v !== "undefined" && String(v).trim() !== "")) return rule.label;
          }
        }
      }
    } catch {}
    return null;
  }, [pkgs, packageLabels]);

  // Package entries sorted by configured order
  const sortedPkgEntries = React.useMemo(() => {
    const entries = Object.entries(allPkgs).filter(([name]) =>
      !isHiddenPackage(name, packageLabels[name])
    );
    return entries.sort((a, b) => {
      const ao = meta?.packageSortOrders?.[a[0]] ?? 0;
      const bo = meta?.packageSortOrders?.[b[0]] ?? 0;
      if (ao !== bo) return ao - bo;
      return (packageLabels[a[0]] ?? a[0]).localeCompare(packageLabels[b[0]] ?? b[0], undefined, { sensitivity: "base" });
    });
  }, [allPkgs, packageLabels, meta?.packageSortOrders]);


  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{entityLabel || "Policy"} #</div>
        <div className="font-mono">{detail.policyNumber}</div>
      </div>
      <div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">Created</div>
        <div className="font-mono">
          {(() => {
            const d = new Date(detail.createdAt);
            return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
          })()}
        </div>
      </div>

      {insuranceType ? (
        <div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">Insurance Type</div>
          <div className="font-mono">{insuranceType}</div>
        </div>
      ) : null}

      {detail.agent && detail.agent.id ? (() => {
        const a = detail.agent!;
        const line1 = (a.userNumber?.trim() ? `${a.userNumber} — ` : "") + (a.name?.trim() ?? "");
        return (
          <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="mb-1 text-sm font-medium">Agent</div>
            <div className="text-xs">
              {line1 ? <div className="mb-0.5">{line1}</div> : null}
              <div className="font-mono">{a.email}</div>
            </div>
          </div>
        );
      })() : null}

      {detail.client ? (
        <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="mb-1 text-sm font-medium">Client</div>
          <div className="font-mono text-sm">{detail.client.clientNumber || "N/A"}</div>
        </div>
      ) : null}

      {sortedPkgEntries.length > 0 ? (
        <div className="space-y-2">
          {sortedPkgEntries.map(([pkgName, pkg]) => {
            const values: Record<string, unknown> = isStructuredPkg(pkg) ? (pkg as StructuredPkg).values ?? {} : (pkg as Record<string, unknown>) ?? {};
            return (
              <PackageSection
                key={pkgName}
                pkgName={pkgName}
                pkg={pkg}
                meta={meta?.pkgMeta?.[pkgName] ?? { labels: {}, sortOrders: {}, groupOrders: {}, groupNames: {}, optionLabels: {}, inputTypes: {}, currencyCodes: {}, formattingMeta: {} }}
                packageLabel={packageLabels[pkgName] ?? pkgName}
                categoryLabel={meta?.categoryLabels?.[pkgName]?.[String(isStructuredPkg(pkg) ? (pkg as StructuredPkg).category : "")] ?? undefined}
                recentKeys={recentKeys}
                onEdit={onEditPackage ? () => onEditPackage(pkgName, packageLabels[pkgName] ?? pkgName, values) : undefined}
              />
            );
          })}
        </div>
      ) : null}

      {isClientRecord ? (
        <ClientLinkedPolicies
          clientPolicyNumber={detail.policyNumber}
          clientPolicyId={detail.policyId}
        />
      ) : null}
    </div>
  );
}
