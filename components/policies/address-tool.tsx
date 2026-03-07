import * as React from "react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { parseHongKongAddress, type ParsedHongKongAddress } from "@/lib/address/hk";

export type AddressFieldKey =
  | "flatNumber"
  | "floorNumber"
  | "blockNumber"
  | "blockName"
  | "streetNumber"
  | "streetName"
  | "propertyName"
  | "districtName"
  | "area"
  | "verifiedAddress"
  | "latitude"
  | "longitude"
  | "placeId";

export type AddressFieldMap = Partial<Record<AddressFieldKey, string>>;

type ParsedWithArea = ParsedHongKongAddress & { area?: string };
type VerifiedGeocode = {
  ok: boolean;
  provider?: string;
  query?: string;
  formattedAddress?: string;
  placeId?: string;
  partialMatch?: boolean;
  locationType?: string;
  location?: { lat: number; lng: number };
  inHongKong?: boolean;
  parts?: Partial<ParsedWithArea>;
  error?: string;
  errorMessage?: string;
};

export function AddressTool({
  form,
  fieldMap,
  areaOptions,
  trigger = (
    <Button type="button" variant="secondary">
      Address Tool
    </Button>
  ),
}: {
  form: UseFormReturn<Record<string, unknown>>;
  fieldMap?: AddressFieldMap;
  areaOptions?: { label?: string; value?: string }[];
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [parsed, setParsed] = React.useState<ParsedWithArea | null>(null);
  const [verified, setVerified] = React.useState<VerifiedGeocode | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [mapping, setMapping] = React.useState<AddressFieldMap>({});
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [fetchedPkgKeys, setFetchedPkgKeys] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadPkgFields() {
      const keys: string[] = [];
      const pkgs = ["contactinfo", "insured"];
      for (const pkg of pkgs) {
        try {
          const res = await fetch(
            `/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`,
            { cache: "no-store" },
          );
          if (!res.ok) continue;
          const rows = (await res.json()) as { value?: string }[];
          for (const r of rows) {
            const v = String(r.value ?? "").trim();
            if (v) keys.push(`${pkg}__${v}`);
          }
        } catch { /* ignore */ }
      }
      if (!cancelled) setFetchedPkgKeys(keys);
    }
    void loadPkgFields();
    return () => { cancelled = true; };
  }, [open]);
  const availableKeys = React.useMemo(() => {
    const raw = Object.keys((form.getValues?.() ?? {}) as Record<string, unknown>);
    const merged = Array.from(new Set([...raw, ...fetchedPkgKeys]));
    const ci = merged.filter((k) => k.toLowerCase().startsWith("contactinfo_") || k.toLowerCase().startsWith("insured_"));
    return ci.length > 0 ? ci : merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fetchedPkgKeys]);
  const storageKey = React.useMemo(() => {
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    return `addressTool.mapping:${path}`;
  }, []);
  const savedRef = React.useRef<AddressFieldMap | null>(null);
  const optionKeys = React.useMemo(() => {
    // Include current form keys + any saved/mapped keys so selections persist
    const extra = Object.values(savedRef.current ?? {}).concat(Object.values(mapping ?? {})).filter(Boolean) as string[];
    const raw = Array.from(new Set<string>([...availableKeys, ...extra]));

    // De-dupe common alias variants that differ only by single vs double underscore prefix.
    // This usually happens because some flows set BOTH `contactinfo_x` and `contactinfo__x`.
    // Keep the currently-selected value when possible so the select doesn't go blank.
    const preferred = new Set(extra.map(String));
    const canonical = (k: string) => {
      const lower = k.toLowerCase();
      if (lower.startsWith("contactinfo__")) return `contactinfo_${k.slice("contactinfo__".length)}`;
      if (lower.startsWith("insured__")) return `insured_${k.slice("insured__".length)}`;
      return k;
    };
    const pickBetter = (a: string, b: string) => {
      if (preferred.has(a) && !preferred.has(b)) return a;
      if (preferred.has(b) && !preferred.has(a)) return b;
      // Prefer single-underscore prefix if both exist
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aIsDouble = aLower.startsWith("contactinfo__") || aLower.startsWith("insured__");
      const bIsDouble = bLower.startsWith("contactinfo__") || bLower.startsWith("insured__");
      if (aIsDouble !== bIsDouble) return aIsDouble ? b : a;
      return a;
    };

    const chosen = new Map<string, string>();
    for (const k of raw) {
      const c = canonical(k);
      const existing = chosen.get(c);
      if (!existing) chosen.set(c, k);
      else chosen.set(c, pickBetter(existing, k));
    }
    return Array.from(new Set<string>([...chosen.values(), ...extra]));
  }, [availableKeys, mapping]);

  function deriveAreaFromDistrict(d?: string): string | undefined {
    if (!d) return undefined;
    const s = d.toLowerCase();
    const kowloon = ["kowloon city", "yau tsim mong", "sham shui po", "wong tai sin", "kwun tong"];
    const hkIsland = ["central and western", "eastern", "southern", "wan chai"];
    const newTerr = [
      "islands",
      "kwai tsing",
      "north",
      "sai kung",
      "sha tin",
      "tai po",
      "tsuen wan",
      "tuen mun",
      "yuen long",
    ];
    if (kowloon.some((k) => s.includes(k))) return "Kowloon";
    if (hkIsland.some((k) => s.includes(k))) return "Hong Kong Island";
    if (newTerr.some((k) => s.includes(k))) return "New Territories";
    return undefined;
  }

  function recomputeMapping() {
    // Build initial mapping using best matches from registered keys, then overlay provided fieldMap
    const registeredNames = availableKeys;
    const lcRegistered = registeredNames.map((n) => n.toLowerCase());
    function scoreFor(fieldLc: string, key: AddressFieldKey): number {
      const has = (s: string) => fieldLc.includes(s);
      const not = (s: string) => !fieldLc.includes(s);
      switch (key) {
        case "flatNumber":
          return (has("flat") || has("unit") || has("rm") || has("room") || has("室")) ? 10 : 0;
        case "floorNumber":
          return (has("floor") || has("floorno") || has("floornumber") || has("flr") || has("level") || has("lvl") || has("/f") || has("樓")) ? 10 : 0;
        case "blockNumber":
          return has("blocknumber") || (has("block") && (has("no") || has("number"))) ? 8 : 0;
        case "blockName":
          return has("blockname") || (has("block") && not("number")) || has("building") || has("tower") || has("court") || has("phase") || has("estate") ? 7 : 0;
        case "streetNumber":
          return (has("street") && (has("no") || has("number"))) || has("streetno") || has("streetnumber") ? 9 : 0;
        case "streetName":
          return (has("street") || has("road") || has("rd") || has("avenue") || has("ave") || has("lane") || has("ln") || has("drive") || has("dr")) && not("no") && not("number") ? 9 : 0;
        case "propertyName":
          return has("property") || has("building") || has("estate") || has("mansion") || has("court") || has("residence") || has("residences") || has("plaza") ? 6 : 0;
        case "districtName":
          return has("district") ? 10 : has("area") ? 5 : 0;
        case "area":
          return has("area") || has("areacode") ? 10 : 0;
        case "verifiedAddress":
          return (has("formattedaddress") || has("fulladdress") || (has("address") && (has("full") || has("formatted") || has("verified"))))
            ? 10
            : 0;
        case "latitude":
          return has("latitude") || (has("lat") && !has("late")) ? 10 : 0;
        case "longitude":
          return has("longitude") || has("lng") || has("lon") ? 10 : 0;
        case "placeId":
          return has("placeid") || (has("place") && has("id")) ? 10 : 0;
        default:
          return 0;
      }
    }
    function findBestMatch(key: AddressFieldKey): string | undefined {
      const scored = lcRegistered
        .map((nameLc, i) => ({ name: registeredNames[i], score: scoreFor(nameLc, key) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      return scored[0]?.name;
    }
    const initial: AddressFieldMap = {
      flatNumber: findBestMatch("flatNumber"),
      floorNumber: findBestMatch("floorNumber"),
      blockNumber: findBestMatch("blockNumber"),
      blockName: findBestMatch("blockName"),
      streetNumber: findBestMatch("streetNumber"),
      streetName: findBestMatch("streetName"),
      propertyName: findBestMatch("propertyName"),
      districtName: findBestMatch("districtName"),
      area: findBestMatch("area"),
      verifiedAddress: findBestMatch("verifiedAddress"),
      latitude: findBestMatch("latitude"),
      longitude: findBestMatch("longitude"),
      placeId: findBestMatch("placeId"),
    };
    // Prefer contactinfo__* keys when present
    const findCI = (suffix: string) => {
      const wantB = `contactinfo_${suffix}`.toLowerCase();
      const wantA = `contactinfo__${suffix}`.toLowerCase(); // fallback
      const idx = lcRegistered.findIndex((n) => n === wantB || n === wantA);
      return idx >= 0 ? registeredNames[idx] : undefined;
    };
    const ciMap: AddressFieldMap = {
      flatNumber: findCI("flatno"),
      floorNumber: findCI("floorno"),
      blockNumber: findCI("blockno"),
      blockName: findCI("blockname"),
      streetNumber: findCI("streetno"),
      streetName: findCI("streetname"),
      propertyName: findCI("propertyname"),
      districtName: findCI("district"),
      area: findCI("area"),
      verifiedAddress: findCI("formattedaddress") ?? findCI("fulladdress") ?? findCI("address"),
      latitude: findCI("latitude") ?? findCI("lat"),
      longitude: findCI("longitude") ?? findCI("lng") ?? findCI("lon"),
      placeId: findCI("placeid"),
    };
    // Load saved mapping (persisted) and prefer it
    let saved: AddressFieldMap = {};
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      if (raw) saved = JSON.parse(raw) as AddressFieldMap;
    } catch {
      // ignore
    }
    // Filter saved mapping to only include current, valid keys
    const filteredSaved: AddressFieldMap = {};
    (Object.keys(saved) as AddressFieldKey[]).forEach((k) => {
      const v = saved[k];
      if (v && registeredNames.includes(String(v))) filteredSaved[k] = v;
    });
    savedRef.current = filteredSaved;
    setMapping({ ...initial, ...ciMap, ...(fieldMap ?? {}), ...filteredSaved });
  }

  function handleParse() {
    const p = parseHongKongAddress(text);
    const area = deriveAreaFromDistrict(p.districtName);
    setParsed({ ...p, area });
    setVerified(null);
    recomputeMapping();
  }

  function handleApply() {
    function deriveAreaFromDistrict(d?: string): string | undefined {
      if (!d) return undefined;
      const s = d.toLowerCase();
      const kowloon = ["kowloon city", "yau tsim mong", "sham shui po", "wong tai sin", "kwun tong"];
      const hkIsland = ["central and western", "eastern", "southern", "wan chai"];
      const newTerr = [
        "islands",
        "kwai tsing",
        "north",
        "sai kung",
        "sha tin",
        "tai po",
        "tsuen wan",
        "tuen mun",
        "yuen long",
      ];
      if (kowloon.some((k) => s.includes(k))) return "Kowloon";
      if (hkIsland.some((k) => s.includes(k))) return "Hong Kong Island";
      if (newTerr.some((k) => s.includes(k))) return "New Territories";
      return undefined;
    }
    // Populate derived area if available
    function normalizeAreaValue(region?: string, targetFieldName?: string): string | undefined {
      if (!region) return undefined;
      const canon = (() => {
        const s = String(region).toLowerCase().replace(/[^a-z0-9]/g, "");
        if (["hongkongisland", "hongkong", "hk", "hki"].includes(s)) return "HKI";
        if (["kowloon", "kln"].includes(s)) return "KLN";
        if (["newterritories", "nt"].includes(s)) return "NT";
        // Fuzzy for common punctuation variants
        if (/^h+k+i?$/.test(s)) return "HKI";
        if (/^k+l+n$/.test(s)) return "KLN";
        if (/^n+t$/.test(s)) return "NT";
        return undefined;
      })();
      // Try to match provided options by normalized label/value
      if (Array.isArray(areaOptions) && areaOptions.length > 0) {
        const normalize = (x?: string) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const want = canon ? normalize(canon) : normalize(region);
        const byExact =
          areaOptions.find((o) => normalize(o.value as string) === want || normalize(o.label as string) === want) ?? null;
        if (byExact) return String(byExact.value ?? byExact.label ?? region);
        // Try synonym matching
        const synonyms: Record<string, string[]> = {
          HKI: ["hongkongisland", "hongkong", "hk", "hki", "hkisland"],
          KLN: ["kowloon", "kln"],
          NT: ["newterritories", "nt", "newterritory"],
        };
        const keys = canon ? (synonyms[canon] ?? []).map((k) => normalize(k)) : [];
        const bySyn =
          areaOptions.find((o) => keys.includes(normalize(o.value as string)) || keys.includes(normalize(o.label as string))) ??
          null;
        if (bySyn) return String(bySyn.value ?? bySyn.label ?? region);
      }
      // Fall back to code/label heuristic
      const label = region;
      const code = canon;
      if (targetFieldName && /code/i.test(targetFieldName)) return code ?? label;
      return label ?? code;
    }
    const values: Record<string, unknown> = { ...(parsed ?? {}) };
    // If Google returned structured parts, use them as a fallback when parse did not extract a field.
    if (verified?.ok && verified.parts) {
      (["flatNumber", "floorNumber", "blockNumber", "blockName", "streetNumber", "streetName", "propertyName", "districtName", "area"] as const).forEach(
        (k) => {
          const curr = values[k];
          const next = (verified.parts as any)?.[k];
          if ((typeof curr === "undefined" || curr === null || String(curr).trim() === "") && typeof next === "string" && next.trim() !== "") {
            values[k] = next.trim();
          }
        },
      );
    }
    if (verified?.ok) {
      if (typeof verified.formattedAddress === "string" && verified.formattedAddress.trim() !== "") {
        values.verifiedAddress = verified.formattedAddress.trim();
      }
      if (typeof verified.placeId === "string" && verified.placeId.trim() !== "") {
        values.placeId = verified.placeId.trim();
      }
      const lat = verified.location?.lat;
      const lng = verified.location?.lng;
      if (typeof lat === "number" && Number.isFinite(lat)) values.latitude = lat;
      if (typeof lng === "number" && Number.isFinite(lng)) values.longitude = lng;
    }
    const derivedArea = deriveAreaFromDistrict(String(parsed?.districtName ?? ""));
    if (parsed?.area || derivedArea) values.area = parsed?.area ?? derivedArea ?? values.area;
    let applied = 0;
    (Object.keys(mapping) as AddressFieldKey[]).forEach((k) => {
      const target = mapping[k];
      const v = values[k];
      if (!target) return;
      if (typeof v === "undefined" || v === null) return;
      try {
        // If the parsed value is an empty string, explicitly clear the form field
        if (String(v).trim() === "") {
          form.setValue(target as never, "" as never, {
            shouldDirty: true,
            shouldValidate: false,
            shouldTouch: true,
          });
          applied += 1;
          return;
        }
        const toWrite =
          k === "area"
            ? normalizeAreaValue(String(v), String(target))
            : k === "floorNumber" && typeof v === "string" && /^\d+$/.test(v)
            ? Number(v)
            : v;
        form.setValue(target as never, toWrite as never, {
          shouldDirty: true,
          shouldValidate: false,
          shouldTouch: true,
        });
        applied += 1;
      } catch {
        // ignore
      }
    });
    if (applied > 0) {
      toast.success(`Address applied to ${applied} field${applied === 1 ? "" : "s"}`);
    } else {
      toast.warning("No matching form fields were updated. Check the Address Tool field mapping.");
    }
    // Persist current mapping for next time
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, JSON.stringify(mapping));
      }
    } catch {
      // ignore
    }
    setOpen(false);
  }

  async function handleVerify() {
    const query = String(text ?? "").trim();
    if (!query) {
      toast.warning("Paste an address first, then click Verify.");
      return;
    }
    if (Object.keys(mapping ?? {}).length === 0) {
      recomputeMapping();
    }
    setVerifying(true);
    try {
      const res = await fetch("/api/address/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: query }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as VerifiedGeocode | null;
      if (!res.ok || !json) {
        const base =
          (json as any)?.error ||
          (res.status === 401 ? "Unauthorized" : res.status === 501 ? "Geocoding is not configured" : "Verify failed");
        const msg = (json as any)?.errorMessage ? `${base}: ${(json as any).errorMessage}` : base;
        setVerified({ ok: false, error: msg });
        toast.error(msg);
        return;
      }
      setVerified(json);
      if (json.ok) {
        const note =
          json.inHongKong === false
            ? "Warning: coordinates appear outside Hong Kong."
            : json.partialMatch
            ? "Partial match — please double-check."
            : "Verified.";
        toast.success(note);
      } else {
        const msg = json.errorMessage ? `${json.error ?? "Verify failed"}: ${json.errorMessage}` : json.error ?? "Verify failed";
        toast.error(msg);
      }
    } catch (err: unknown) {
      const msg = (err as any)?.message ?? "Verify failed";
      setVerified({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setVerifying(false);
    }
  }

  function renderTrigger() {
    if (React.isValidElement(trigger)) {
      const element = trigger as React.ReactElement<React.DOMAttributes<Element>>;
      const originalOnClick = element.props.onClick;
      return React.cloneElement(element, {
        onClick: (e) => {
          originalOnClick?.(e);
          setOpen(true);
        },
      });
    }
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Address Tool
      </Button>
    );
  }

  // Load shared (admin-saved) mapping for this path when dialog opens
  React.useEffect(() => {
    // Focus textarea when opening dialog, but do not steal focus afterwards
    if (open) {
      try {
        textareaRef.current?.focus();
      } catch {
        // ignore
      }
    }
    if (!open) return;
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    (async () => {
      try {
        const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent("address_tool_mapping")}`, { cache: "no-store" });
        if (!res.ok) return;
        const rows = (await res.json()) as { id: number; value?: string; meta?: { mapping?: AddressFieldMap } }[];
        const found = rows.find((r) => (r?.value ?? "") === path);
        if (found && found.meta && typeof found.meta.mapping === "object") {
          const m = found.meta.mapping as AddressFieldMap;
          // Only accept keys that exist in the current form
          const filtered: AddressFieldMap = {};
          (Object.keys(m) as AddressFieldKey[]).forEach((k) => {
            const v = m[k];
            if (v && availableKeys.includes(String(v))) filtered[k] = v;
          });
          setMapping((prev) => ({ ...prev, ...filtered }));
        }
      } catch {
        // ignore
      }
    })();
  }, [open, availableKeys]);

  async function saveMapping() {
    try {
      const path = typeof window !== "undefined" ? window.location.pathname : "/";
      // Check if mapping already exists (admin endpoint ensures permission check)
      let existingId: number | null = null;
      try {
        const check = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent("address_tool_mapping")}`, {
          cache: "no-store",
        });
        if (check.ok) {
          const rows = (await check.json()) as { id: number; value?: string }[];
          const found = rows.find((r) => (r?.value ?? "") === path);
          if (found) existingId = Number(found.id);
        }
      } catch {
        // ignore; fallback to POST
      }

      // Only persist keys that currently exist
      const validToSave: AddressFieldMap = {};
      (Object.keys(mapping) as AddressFieldKey[]).forEach((k) => {
        const v = mapping[k];
        if (v && availableKeys.includes(String(v))) validToSave[k] = v;
      });

      if (existingId != null) {
        const patch = await fetch(`/api/admin/form-options/${existingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meta: { mapping: validToSave } }),
        });
        if (!patch.ok) {
          const t = await patch.text().catch(() => "");
          throw new Error(`Update failed (${patch.status}) ${t}`.trim());
        }
        toast.success("Mapping updated for all users");
        return;
      }

      const create = await fetch(`/api/admin/form-options`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupKey: "address_tool_mapping",
          label: "Address Tool Mapping",
          value: path,
          valueType: "string",
          sortOrder: 0,
          isActive: true,
          meta: { mapping: validToSave },
        }),
      });
      if (!create.ok) {
        const t = await create.text().catch(() => "");
        throw new Error(`Create failed (${create.status}) ${t}`.trim());
      }
      toast.success("Mapping saved for all users");
    } catch (err: unknown) {
      const msg = (err as { message?: string } | undefined)?.message ?? "Save failed";
      toast.error(msg.includes("Forbidden") || msg.includes("401") || msg.includes("403") ? "Only admins can save mapping." : msg);
    }
  }

  // Row renderer inside component to access state via closure
  function Row({
    field,
    label,
    value,
    onDistrictChange,
  }: {
    field: AddressFieldKey;
    label: string;
    value?: string;
    onDistrictChange?: boolean;
  }) {
    const [local, setLocal] = React.useState<string>(value ?? "");
    // Sync when value prop changes from external events (e.g., re-parse)
    React.useEffect(() => {
      setLocal(value ?? "");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
      <div className="grid grid-cols-12 items-end gap-2">
        <div className="col-span-5">
          <Label>{label}</Label>
          <Input
            value={local}
            onKeyDown={(e) => {
              // Keep focus inside this input while typing
              e.stopPropagation();
            }}
            onKeyUp={(e) => {
              e.stopPropagation();
            }}
            onKeyPress={(e) => {
              e.stopPropagation();
            }}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={() => {
              const next = local;
              if (onDistrictChange) {
                const area = deriveAreaFromDistrict(next);
                setParsed((p) => ({ ...(p ?? {}), [field]: next, area } as ParsedWithArea));
              } else {
                setParsed((p) => ({ ...(p ?? {}), [field]: next } as ParsedWithArea));
              }
            }}
          />
        </div>
        <div className="col-span-7">
          <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
          <select
            className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            value={mapping[field] ?? ""}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
            onChange={(e) => {
              const next = { ...mapping, [field]: e.target.value } as AddressFieldMap;
              setMapping(next);
              try {
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(storageKey, JSON.stringify(next));
                }
              } catch {
                // ignore
              }
            }}
          >
            <option value="">-- Do not apply --</option>
            {optionKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  function MappingSelect({ field }: { field: AddressFieldKey }) {
    return (
      <select
        className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        value={mapping[field] ?? ""}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
        onChange={(e) => {
          const next = { ...mapping, [field]: e.target.value } as AddressFieldMap;
          setMapping(next);
          try {
            if (typeof window !== "undefined") {
              window.localStorage.setItem(storageKey, JSON.stringify(next));
            }
          } catch {
            // ignore
          }
        }}
      >
        <option value="">-- Do not apply --</option>
        {optionKeys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      {renderTrigger()}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Address Parse Tool</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Paste full address</Label>
              <textarea
                className="min-h-[100px] w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                value={text}
              ref={textareaRef}
              onKeyDown={(e) => {
                // Prevent parent hotkeys/focus traps from stealing focus while typing
                e.stopPropagation();
              }}
              onKeyUp={(e) => {
                e.stopPropagation();
              }}
              onKeyPress={(e) => {
                e.stopPropagation();
              }}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Flat C, 26/F, BLK 16 Laguna Verde, 9 Hung Hom Road, Hung Hom, Kowloon"
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Tip: Include flat, floor, block, building/estate, street number/name, and district if available.
              </p>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={handleParse}>
                Parse
                </Button>
                <Button type="button" variant="secondary" onClick={handleVerify} disabled={verifying || String(text ?? "").trim() === ""}>
                  {verifying ? "Verifying…" : "Verify (Geocode)"}
                </Button>
              </div>
            </div>
            {parsed ? (
              <div className="grid gap-3">
                <Row label="Flat Number" field="flatNumber" value={parsed.flatNumber} />
                <Row label="Floor Number" field="floorNumber" value={parsed.floorNumber} />
                <Row label="Block Number" field="blockNumber" value={parsed.blockNumber} />
                <Row label="Block Name" field="blockName" value={parsed.blockName} />
                <Row label="Street Number" field="streetNumber" value={parsed.streetNumber} />
                <Row label="Street Name" field="streetName" value={parsed.streetName} />
                <Row label="Property Name" field="propertyName" value={parsed.propertyName} />
                <Row label="District Name" field="districtName" value={parsed.districtName} onDistrictChange />
                <Row label="Area" field="area" value={parsed.area} />
              </div>
            ) : null}

            {verified ? (
              <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="mb-2 text-sm font-medium">Verification</div>
                {verified.ok ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-12 items-end gap-2">
                      <div className="col-span-5">
                        <Label>Verified Address</Label>
                        <Input value={verified.formattedAddress ?? ""} readOnly />
                      </div>
                      <div className="col-span-7">
                        <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                        <MappingSelect field="verifiedAddress" />
                      </div>
                    </div>

                    {verified.parts ? (
                      <>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>Flat / Room (from Verify)</Label>
                            <Input value={verified.parts.flatNumber ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="flatNumber" />
                          </div>
                        </div>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>Floor (from Verify)</Label>
                            <Input value={verified.parts.floorNumber ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="floorNumber" />
                          </div>
                        </div>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>Block No. (from Verify)</Label>
                            <Input value={verified.parts.blockNumber ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="blockNumber" />
                          </div>
                        </div>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>Block Name (from Verify)</Label>
                            <Input value={verified.parts.blockName ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="blockName" />
                          </div>
                        </div>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>Property / Estate (from Google)</Label>
                            <Input value={verified.parts.propertyName ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="propertyName" />
                          </div>
                        </div>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>Street Number (from Google)</Label>
                            <Input value={verified.parts.streetNumber ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="streetNumber" />
                          </div>
                        </div>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>Street Name (from Google)</Label>
                            <Input value={verified.parts.streetName ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="streetName" />
                          </div>
                        </div>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>District (from Google)</Label>
                            <Input value={verified.parts.districtName ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="districtName" />
                          </div>
                        </div>
                        <div className="grid grid-cols-12 items-end gap-2">
                          <div className="col-span-5">
                            <Label>Area / Region (from Google)</Label>
                            <Input value={verified.parts.area ?? ""} readOnly />
                          </div>
                          <div className="col-span-7">
                            <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                            <MappingSelect field="area" />
                          </div>
                        </div>
                      </>
                    ) : null}

                    <div className="grid grid-cols-12 items-end gap-2">
                      <div className="col-span-5">
                        <Label>Latitude</Label>
                        <Input value={typeof verified.location?.lat === "number" ? String(verified.location.lat) : ""} readOnly />
                      </div>
                      <div className="col-span-7">
                        <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                        <MappingSelect field="latitude" />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 items-end gap-2">
                      <div className="col-span-5">
                        <Label>Longitude</Label>
                        <Input value={typeof verified.location?.lng === "number" ? String(verified.location.lng) : ""} readOnly />
                      </div>
                      <div className="col-span-7">
                        <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                        <MappingSelect field="longitude" />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 items-end gap-2">
                      <div className="col-span-5">
                        <Label>Place ID</Label>
                        <Input value={verified.placeId ?? ""} readOnly />
                      </div>
                      <div className="col-span-7">
                        <Label className="text-xs text-yellow-500 dark:text-yellow-400">Map to form field (Admin Only)</Label>
                        <MappingSelect field="placeId" />
                      </div>
                    </div>

                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      {verified.locationType ? `Location type: ${verified.locationType}. ` : null}
                      {verified.partialMatch ? "Partial match. " : null}
                      {verified.inHongKong === false ? "Warning: outside Hong Kong bounds." : null}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 text-sm text-red-600 dark:text-red-400">
                    <div>{verified.error ?? "Verify failed"}</div>
                    {verified.errorMessage ? <div className="text-xs text-neutral-500 dark:text-neutral-400">{verified.errorMessage}</div> : null}
                    {String(verified.error ?? "").includes("REQUEST_DENIED") ? (
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">
                        Tip: restart your dev server after changing `.env.local`, and ensure your Google key has Geocoding API enabled + billing +
                        server-side key restrictions.
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              onClick={saveMapping}
              title="Admins only"
              className="min-w-[80px] bg-yellow-400 text-black hover:bg-yellow-500 dark:bg-yellow-500 dark:text-black dark:hover:bg-yellow-400"
            >
              Save Mapping (Admin)
            </Button>
            <Button type="button" size="sm" onClick={handleApply} disabled={!parsed && !verified?.ok} className="min-w-[80px]">
              Apply to Form
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)} className="min-w-[80px]">
              Cancel
            </Button>
          </DialogFooter>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                try {
                  if (typeof window !== "undefined") {
                    window.localStorage.removeItem(storageKey);
                  }
                } catch {
                  // ignore
                }
                setMapping({});
                toast.success("Local mapping cleared");
              }}
            >
              Reset Mapping (Local)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// (no module-scope components)
