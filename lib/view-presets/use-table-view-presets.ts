"use client";

/**
 * `useTableViewPresets` — single source of truth for any dashboard table
 * that needs saved column-view presets.
 *
 * Every consumer (Policies, Users, Agents, ...) hits the same backend
 * (`/api/view-presets?scope=...`), uses the same shape (`ViewPreset`),
 * and respects the same MAX of 5 saved views.
 *
 * The hook handles:
 *   - GET on mount, with localStorage fallback when the API is offline
 *   - PUT on every save (writes both API and localStorage)
 *   - Active preset selection (default preset wins on first load)
 *   - upsert / delete / setDefault helpers
 *
 * The hook is intentionally NOT opinionated about what `columns` means.
 * See `lib/view-presets/types.ts` and the skill at
 * `.cursor/skills/table-view-presets/SKILL.md`.
 */

import * as React from "react";
import { toast } from "sonner";
import {
  VIEW_PRESETS_MAX,
  type ViewPreset,
} from "@/lib/view-presets/types";

export type UseTableViewPresetsOptions = {
  /** Distinct namespace per table. Same scope must be used by every page that
   *  shares the same view (e.g. all `policies` flow pages). */
  scope: string;
  /** Optional legacy localStorage key. When provided, the hook reads it as a
   *  fallback before falling back to an empty list — supports tables that
   *  shipped a localStorage cache before the API existed. */
  legacyLocalStorageKey?: string;
  /** Optional validator/normalizer applied to each preset returned from the
   *  API or localStorage. Useful for tables with a fixed column-key enum. */
  normalizePreset?: (raw: unknown) => ViewPreset | null;
};

export type UseTableViewPresetsReturn = {
  presets: ViewPreset[];
  presetsLoaded: boolean;
  activePresetId: string | null;
  setActivePresetId: (id: string | null) => void;
  /** Currently selected preset (default if none chosen). May be `null` until
   *  the API has responded. */
  activePreset: ViewPreset | null;
  /** Replace the entire list (rarely needed; prefer `upsertPreset` /
   *  `deletePreset`). Persists immediately. */
  savePresets: (next: ViewPreset[]) => void;
  /** Insert if `id` not in list, otherwise replace. Enforces `VIEW_PRESETS_MAX`
   *  on insert and shows a toast on overflow. Returns the resulting preset
   *  on success, `null` on rejection. */
  upsertPreset: (preset: ViewPreset) => ViewPreset | null;
  /** Remove by id. If the deleted preset was default and any remain, the
   *  first remaining is promoted to default so the table never ends up
   *  with zero defaults. */
  deletePreset: (id: string) => void;
  /** Mark `id` as default and clear default on every other preset. */
  setDefault: (id: string) => void;
};

function readLegacyLocalStorage(key: string): ViewPreset[] | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ViewPreset[]) : null;
  } catch {
    return null;
  }
}

function writeLegacyLocalStorage(key: string, value: ViewPreset[]) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* swallow quota errors */
  }
}

export function useTableViewPresets(
  options: UseTableViewPresetsOptions,
): UseTableViewPresetsReturn {
  const { scope, legacyLocalStorageKey, normalizePreset } = options;

  const [presets, setPresets] = React.useState<ViewPreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = React.useState(false);
  const [activePresetId, setActivePresetId] = React.useState<string | null>(
    null,
  );

  const presetsRef = React.useRef(presets);
  React.useEffect(() => {
    presetsRef.current = presets;
  }, [presets]);

  const apiUrl = React.useMemo(
    () => `/api/view-presets?scope=${encodeURIComponent(scope)}`,
    [scope],
  );

  React.useEffect(() => {
    let cancelled = false;
    fetch(apiUrl, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: unknown) => {
        if (cancelled) return;
        let incoming: ViewPreset[] = [];
        if (Array.isArray(data)) {
          incoming = data as ViewPreset[];
        } else if (legacyLocalStorageKey) {
          const legacy = readLegacyLocalStorage(legacyLocalStorageKey);
          if (legacy) incoming = legacy;
        }
        if (normalizePreset) {
          incoming = incoming
            .map((p) => normalizePreset(p))
            .filter((p): p is ViewPreset => p !== null);
        }
        setPresets(incoming);
        setPresetsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, legacyLocalStorageKey, normalizePreset]);

  const persist = React.useCallback(
    (next: ViewPreset[]) => {
      setPresets(next);
      if (legacyLocalStorageKey) writeLegacyLocalStorage(legacyLocalStorageKey, next);
      fetch(apiUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {
        // Silent: localStorage already mirrors. The next mount will reconcile.
      });
    },
    [apiUrl, legacyLocalStorageKey],
  );

  const savePresets = React.useCallback(
    (next: ViewPreset[]) => {
      persist(next);
    },
    [persist],
  );

  const upsertPreset = React.useCallback(
    (preset: ViewPreset): ViewPreset | null => {
      const current = presetsRef.current;
      const idx = current.findIndex((p) => p.id === preset.id);
      if (idx === -1 && current.length >= VIEW_PRESETS_MAX) {
        toast.error(`Maximum ${VIEW_PRESETS_MAX} views allowed`);
        return null;
      }
      let next: ViewPreset[];
      if (idx === -1) {
        const isDefault = preset.isDefault || current.length === 0;
        const cleared = isDefault
          ? current.map((p) => ({ ...p, isDefault: false }))
          : current;
        next = [...cleared, { ...preset, isDefault }];
      } else {
        next = current.map((p, i) => {
          if (i === idx) return { ...preset };
          return preset.isDefault ? { ...p, isDefault: false } : p;
        });
      }
      persist(next);
      return next.find((p) => p.id === preset.id) ?? null;
    },
    [persist],
  );

  const deletePreset = React.useCallback(
    (id: string) => {
      const current = presetsRef.current;
      const next = current.filter((p) => p.id !== id);
      if (next.length > 0 && !next.some((p) => p.isDefault)) {
        next[0] = { ...next[0], isDefault: true };
      }
      persist(next);
      setActivePresetId((prev) => (prev === id ? next[0]?.id ?? null : prev));
    },
    [persist],
  );

  const setDefault = React.useCallback(
    (id: string) => {
      const current = presetsRef.current;
      const next = current.map((p) => ({ ...p, isDefault: p.id === id }));
      persist(next);
    },
    [persist],
  );

  const defaultPreset = React.useMemo(
    () => presets.find((p) => p.isDefault) ?? presets[0] ?? null,
    [presets],
  );

  React.useEffect(() => {
    if (presetsLoaded && activePresetId === null && defaultPreset) {
      setActivePresetId(defaultPreset.id);
    }
  }, [presetsLoaded, activePresetId, defaultPreset]);

  const activePreset = React.useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? defaultPreset,
    [presets, activePresetId, defaultPreset],
  );

  return {
    presets,
    presetsLoaded,
    activePresetId,
    setActivePresetId,
    activePreset,
    savePresets,
    upsertPreset,
    deletePreset,
    setDefault,
  };
}
