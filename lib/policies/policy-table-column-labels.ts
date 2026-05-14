import { normalizeFieldKey } from "@/lib/utils";

/** Same legacy package mapping as PolicySnapshotView for field definition lookup. */
export const POLICY_TABLE_LEGACY_PKG_MAP: Record<string, string> = {
  accounting: "premiumRecord",
};

type CaseMode = "original" | "upper" | "lower" | "title";

export type MutablePolicyTableFieldMaps = {
  labels: Record<string, string>;
  orders: Record<string, number>;
  cases: Record<string, CaseMode>;
  /** Mirrors admin `meta.groupOrder` (Policy snapshot panel section stack). */
  groupOrders: Record<string, number>;
};

function toKey(v: unknown): string {
  return String(v ?? "").trim();
}

function applyCaseToLabel(rawLbl: string, mode: CaseMode): string {
  if (!mode || mode === "original") return rawLbl;
  if (mode === "upper") return rawLbl.toUpperCase();
  if (mode === "lower") return rawLbl.toLowerCase();
  return rawLbl.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Mirrors PoliciesTableClient’s triplicate path registration so lookups match
 * `flattenExtra()` keys (`pkg.{pkg}.{tail}` plus prefixed variants).
 */
export function registerPolicyTableFieldAliases(
  mut: MutablePolicyTableFieldMaps,
  pkg: string,
  rawSnapshotTail: string,
  lbl: string,
  order: number,
  effectiveCase: CaseMode,
  /** Admin subsection order; cascaded fields inherit caller’s section. */
  groupOrderInSection = 0,
): void {
  const prefixes = pkg === "insured" ? (["insured"] as const) : ([`pkg.${pkg}`] as const);
  for (const pfx of prefixes) {
    mut.labels[`${pfx}.${rawSnapshotTail}`] = lbl;
    mut.orders[`${pfx}.${rawSnapshotTail}`] = order;
    mut.cases[`${pfx}.${rawSnapshotTail}`] = effectiveCase;
    mut.groupOrders[`${pfx}.${rawSnapshotTail}`] = groupOrderInSection;
    mut.labels[`${pfx}.${pkg}__${rawSnapshotTail}`] = lbl;
    mut.orders[`${pfx}.${pkg}__${rawSnapshotTail}`] = order;
    mut.cases[`${pfx}.${pkg}__${rawSnapshotTail}`] = effectiveCase;
    mut.groupOrders[`${pfx}.${pkg}__${rawSnapshotTail}`] = groupOrderInSection;
    mut.labels[`${pfx}.${pkg}_${rawSnapshotTail}`] = lbl;
    mut.orders[`${pfx}.${pkg}_${rawSnapshotTail}`] = order;
    mut.cases[`${pfx}.${pkg}_${rawSnapshotTail}`] = effectiveCase;
    mut.groupOrders[`${pfx}.${pkg}_${rawSnapshotTail}`] = groupOrderInSection;
  }
}

function registerChildLabelsForPolicyTable(
  mut: MutablePolicyTableFieldMaps,
  pkg: string,
  parentKey: string,
  /** Label before labelCase formatting (typically "Parent — Child"). */
  parentDisplayLabelPlain: string,
  parentOrder: number,
  effectiveCase: CaseMode,
  parentGroupOrderInSection: number,
  childrenArr: unknown[],
  keyPrefix: string,
  depth: number,
): void {
  childrenArr.forEach((childRaw, idx: number) => {
    const child = childRaw as Record<string, unknown>;
    const childKey = `${parentKey}__${keyPrefix}${idx}`;
    const childLabelRaw = toKey(child?.label);
    const childLabel =
      childLabelRaw && childLabelRaw.toLowerCase() !== "details"
        ? childLabelRaw
        : "Details";
    const childInputType =
      typeof child?.inputType === "string" ? String(child.inputType) : "";
    const isRepeatable =
      Boolean(child?.repeatable) || childInputType === "repeatable";
    const displayLabelPlain = isRepeatable
      ? childLabelRaw && childLabelRaw.toLowerCase() !== "details"
        ? childLabelRaw
        : parentDisplayLabelPlain
      : `${parentDisplayLabelPlain} — ${childLabel}`;

    const ord = parentOrder + (idx + 1) * 0.001 + depth * 1e-9;
    const lbl = applyCaseToLabel(displayLabelPlain, effectiveCase);
    registerPolicyTableFieldAliases(
      mut,
      pkg,
      childKey,
      lbl,
      ord,
      effectiveCase,
      parentGroupOrderInSection,
    );

    const bc = child.booleanChildren as
      | { true?: unknown[]; false?: unknown[] }
      | undefined;
    if (bc) {
      for (const [br, arr] of [
        ["true", bc.true],
        ["false", bc.false],
      ] as Array<[string, unknown[] | undefined]>) {
        if (!Array.isArray(arr)) continue;
        registerChildLabelsForPolicyTable(
          mut,
          pkg,
          childKey,
          displayLabelPlain,
          parentOrder,
          effectiveCase,
          parentGroupOrderInSection,
          arr,
          `${br}__bc`,
          depth + 1,
        );
      }
    }

    const opts = child.options as
      | Array<{ value?: unknown; label?: unknown; children?: unknown }>
      | undefined;
    if (Array.isArray(opts)) {
      for (const o of opts) {
        const optVal = toKey(o?.value ?? "");
        const children = Array.isArray(o?.children) ? o.children : [];
        if (!optVal || children.length === 0) continue;
        registerChildLabelsForPolicyTable(
          mut,
          pkg,
          childKey,
          displayLabelPlain,
          parentOrder,
          effectiveCase,
          parentGroupOrderInSection,
          children,
          `opt_${optVal}__c`,
          depth + 1,
        );
      }
    }
  });
}

/** Walk admin field meta.options + booleanChildren to register cascading keys. */
export function expandPolicyTableMapsWithCompositeChildren(
  mut: MutablePolicyTableFieldMaps,
  pkg: string,
  meta: Record<string, unknown> | null | undefined,
  adminFieldKey: string,
  parentLabelPlain: string,
  parentOrder: number,
  effectiveCase: CaseMode,
  parentGroupOrderInSection = 0,
): void {
  if (!meta || typeof meta !== "object") return;

  const opts = meta.options as
    | Array<{ value?: unknown; label?: unknown; children?: unknown }>
    | undefined;
  if (Array.isArray(opts)) {
    for (const o of opts) {
      const optVal = toKey(o?.value ?? "");
      const children = Array.isArray(o?.children) ? o.children : [];
      if (!optVal || children.length === 0) continue;
      registerChildLabelsForPolicyTable(
        mut,
        pkg,
        adminFieldKey,
        parentLabelPlain,
        parentOrder,
        effectiveCase,
        parentGroupOrderInSection,
        children,
        `opt_${optVal}__c`,
        0,
      );
    }
  }

  const bc = meta.booleanChildren as { true?: unknown[]; false?: unknown[] };
  if (bc) {
    for (const [br, arr] of [
      ["true", bc.true],
      ["false", bc.false],
    ] as Array<[string, unknown[] | undefined]>) {
      if (!Array.isArray(arr)) continue;
      registerChildLabelsForPolicyTable(
        mut,
        pkg,
        adminFieldKey,
        parentLabelPlain,
        parentOrder,
        effectiveCase,
        parentGroupOrderInSection,
        arr,
        `${br}__c`,
        0,
      );
    }
  }
}

/**
 * Fallback when no admin-derived label exists: strip cascading / boolean /
 * repeatable suffix tokens then title-case a readable base — same behaviour as
 * PolicySnapshotView.humanizeFieldKey (without duplicate package lookups).
 */
export function humanizePolicyTableTailKey(keyTail: string, pkgName?: string): string {
  let s = keyTail.replace(/^_+/, "");
  s = s.replace(/__opt_[^_]+/g, "");
  s = s.replace(/__c\d+/g, "");
  s = s.replace(/__bc\d+/g, "");
  s = s.replace(/__(true|false)/g, "");
  s = s.replace(/__r\d+__/g, " ");
  if (pkgName) {
    for (const p of [`${pkgName}__`, `${pkgName}_`]) {
      if (s.startsWith(p) && s.length > p.length) {
        s = s.slice(p.length);
        break;
      }
    }
  }
  const dblIdx = s.indexOf("__");
  let base =
    !pkgName && dblIdx > 0 && dblIdx < s.length - 2 ? s.slice(dblIdx + 2) : s;
  base = stripLeadingDuplicatePackageToken(base);

  let display = base.replace(/__+/g, " ").replace(/_+/g, " ");
  display = display.replace(/([a-z])([A-Z])/g, "$1 $2");
  return display.replace(/\b\w/g, (c) => c.toUpperCase()).trim() || keyTail;
}

/** If the tail looks like `{pkg}__rest`, drop `{pkg}` for display (handles double prefix). */
function stripLeadingDuplicatePackageToken(base: string): string {
  const ix = base.indexOf("__");
  if (ix <= 0) return base;
  const head = base.slice(0, ix).replace(/_/g, "");
  const tail = base.slice(ix + 2);
  const tailClean = tail.replace(/^[_]+/, "");
  if (!tailClean) return base;
  if (normalizeFieldKey(head) === normalizeFieldKey(tailClean.split("__")[0] ?? ""))
    return tail;
  return base;
}

