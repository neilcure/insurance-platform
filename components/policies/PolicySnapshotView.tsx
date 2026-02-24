"use client";

import * as React from "react";
import { formatContactLabel, getContactSortWeight } from "@/lib/format/contact-info";

type PolicySnapshotDetail = {
  policyNumber: string;
  createdAt: string;
  extraAttributes?: {
    packagesSnapshot?: Record<string, unknown>;
    insuredSnapshot?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  client?: { id: number; clientNumber?: string; createdAt?: string } | null;
  agent?: { id: number; userNumber?: string | null; name?: string | null; email?: string } | null;
};

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
const normalizeKey = (s: string) => s.replace(/^_+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

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
  const [packagesRes, ...fieldAndCatResults] = await Promise.all([
    fetch(`/api/form-options?groupKey=packages`, { cache: "no-store" }).then(r => r.ok ? r.json() : []).catch(() => []),
    ...packageNames.flatMap(pkg => [
      fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`, { cache: "no-store" }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_category`)}`, { cache: "no-store" }).then(r => r.ok ? r.json() : []).catch(() => []),
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

function resolveKey(key: string, labels: Record<string, string>): string {
  if (labels[key]) return key;
  const stripped = key.replace(/^_+/, "");
  if (stripped !== key && labels[stripped]) return stripped;
  const nk = normalizeKey(key);
  const match = Object.keys(labels).find(k => normalizeKey(k) === nk);
  return match ?? key;
}

function humanizeFieldKey(key: string, labels: Record<string, string>): string {
  let s = key.replace(/^_+/, "");
  s = s.replace(/__opt_[^_]+/g, "");
  s = s.replace(/__c\d+/g, "");
  s = s.replace(/__bc\d+/g, "");
  s = s.replace(/__(true|false)/g, "");
  const parentToken = normalizeKey(s.split("__")[0] ?? s);
  const parentMatch = Object.keys(labels).find(k => normalizeKey(k) === parentToken);
  if (parentMatch) return labels[parentMatch] ?? parentMatch;
  s = s.replace(/__+/g, " — ").replace(/_+/g, " ");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  return s.replace(/\b\w/g, c => c.toUpperCase()).trim() || key;
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
}: {
  pkgName: string;
  pkg: unknown;
  meta: FieldMeta;
  packageLabel: string;
  categoryLabel?: string;
}) {
  const values: Record<string, unknown> = isStructuredPkg(pkg) ? (pkg as StructuredPkg).values ?? {} : (pkg as Record<string, unknown>) ?? {};
  const category = isStructuredPkg(pkg) ? (pkg as StructuredPkg).category : undefined;
  const displayCategoryLabel = category
    ? (categoryLabel ?? String(category))
    : undefined;

  const resolve = (key: string) => resolveKey(key, meta.labels);
  const label = (key: string) => {
    const rk = resolve(key);
    const registered = meta.labels[rk];
    const raw = registered ?? humanizeFieldKey(key, meta.labels);
    return applyCase(raw, meta.formattingMeta[rk]?.labelCase);
  };
  const getType = (key: string) => meta.inputTypes[resolve(key)] ?? "";
  const getOptMap = (key: string) => meta.optionLabels[resolve(key)] ?? {};
  const getFmt = (key: string) => meta.formattingMeta[resolve(key)];

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
        {displayCategoryLabel ? (
          <div className="text-xs text-neutral-500">Category: {displayCategoryLabel}</div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {kvs.map(([k, v]) => {
          const rk = resolve(k);
          const fieldLabel = label(k);
          const type = getType(k);
          const fmt = getFmt(k);

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
                  <div className="text-neutral-500">{`${fieldLabel} — Name`}</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{names.filter(Boolean).join(", ")}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500">{`${fieldLabel} — Price`}</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{prices.filter(Boolean).join(", ")}</div>
                </div>
              </React.Fragment>
            );
          }

          const valueText = formatFieldValue(v, type, getOptMap(k), fmt);
          return (
            <div key={k} className="flex items-start justify-between gap-3 text-xs">
              <div className="text-neutral-500">{fieldLabel}</div>
              <div className="max-w-[60%] wrap-break-word font-mono text-right">{valueText}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PolicySnapshotView({ detail }: { detail: PolicySnapshotDetail }) {
  const [meta, setMeta] = React.useState<{
    pkgMeta: Record<string, FieldMeta>;
    packageLabels: Record<string, string>;
    packageSortOrders: Record<string, number>;
    categoryLabels: Record<string, Record<string, string>>;
  } | null>(null);

  const snap = (detail.extraAttributes ?? {}) as Record<string, unknown>;
  const pkgs = (snap.packagesSnapshot ?? {}) as Record<string, unknown>;
  const pkgNames = React.useMemo(() => Object.keys(pkgs), [pkgs]);

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
    const entries = Object.entries(pkgs).filter(([name]) => {
      const nk = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (nk === "insured" || nk === "contactinfo" || nk === "contactinformation") return false;
      if (nk.includes("newexistingclient") || nk.includes("existorcreateclient") || nk.includes("existcreate") || nk.includes("chooseclient")) return false;
      const label = (packageLabels[name] ?? name).toLowerCase();
      if (label.includes("new or existing client")) return false;
      return true;
    });
    return entries.sort((a, b) => {
      const ao = meta?.packageSortOrders?.[a[0]] ?? 0;
      const bo = meta?.packageSortOrders?.[b[0]] ?? 0;
      if (ao !== bo) return ao - bo;
      return (packageLabels[a[0]] ?? a[0]).localeCompare(packageLabels[b[0]] ?? b[0], undefined, { sensitivity: "base" });
    });
  }, [pkgs, packageLabels, meta?.packageSortOrders]);

  // Insured/Contact snapshot
  const insuredSnap = (snap.insuredSnapshot ?? null) as Record<string, unknown> | null;

  const renderInsuredBlock = (prefix: "insured_" | "contactinfo_", title: string) => {
    if (!insuredSnap || typeof insuredSnap !== "object") return null;
    const rows = Object.entries(insuredSnap)
      .filter(([k, v]) => {
        const kk = k.toLowerCase();
        if (!kk.startsWith(prefix) && !(prefix === "insured_" && kk === "insuredtype")) return false;
        return !(v === null || typeof v === "undefined" || String(v).trim() === "");
      })
      .sort((a, b) => getContactSortWeight(a[0]) - getContactSortWeight(b[0]));
    if (rows.length === 0) return null;
    return (
      <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-[11px] text-neutral-500">Snapshot</div>
        </div>
        <div className="grid grid-cols-1 gap-1 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-2">
              <div className="text-neutral-500">{formatContactLabel("", k)}</div>
              <div className="max-w-[60%] wrap-break-word font-mono text-right">{String(v ?? "")}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-neutral-500">Policy #</div>
        <div className="font-mono">{detail.policyNumber}</div>
      </div>
      <div>
        <div className="text-xs text-neutral-500">Created</div>
        <div className="font-mono">
          {(() => {
            const d = new Date(detail.createdAt);
            return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
          })()}
        </div>
      </div>

      {insuranceType ? (
        <div>
          <div className="text-xs text-neutral-500">Insurance Type</div>
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

      {renderInsuredBlock("insured_", "Insured")}
      {renderInsuredBlock("contactinfo_", "Contact Information")}

      {sortedPkgEntries.length > 0 ? (
        <div className="space-y-2">
          {sortedPkgEntries.map(([pkgName, pkg]) => (
            <PackageSection
              key={pkgName}
              pkgName={pkgName}
              pkg={pkg}
              meta={meta?.pkgMeta?.[pkgName] ?? { labels: {}, sortOrders: {}, groupOrders: {}, groupNames: {}, optionLabels: {}, inputTypes: {}, currencyCodes: {}, formattingMeta: {} }}
              packageLabel={packageLabels[pkgName] ?? pkgName}
              categoryLabel={meta?.categoryLabels?.[pkgName]?.[String(isStructuredPkg(pkg) ? (pkg as StructuredPkg).category : "")] ?? undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
