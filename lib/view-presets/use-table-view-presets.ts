"use client";

/**
 * `useTableViewPresets` — single source of truth for any dashboard table
 * that needs saved column-view presets.
 *
 * Every consumer hits the same backend (`/api/view-presets?scope=...`), uses the
 * same shape (`ViewPreset`), and respects the same MAX of 5 saved views
 * **per user** and **per organisation** (organisation defaults apply only
 * while the user list is empty — first personal save forks a private copy).
 *
 * See `lib/view-presets/types.ts` and the skill at
 * `.cursor/skills/table-view-presets/SKILL.md`.
 */

import * as React from "react";
import { toast } from "sonner";
import {
  VIEW_PRESETS_MAX,
  type ViewPreset,
} from "@/lib/view-presets/types";

type ParsedBootstrap = {
  user: ViewPreset[];
  organisation: ViewPreset[];
};

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
  /** Effective list shown in UI: user's saves, or organisation defaults if none. */
  presets: ViewPreset[];
  presetsLoaded: boolean;
  activePresetId: string | null;
  setActivePresetId: (id: string | null) => void;
  /** Currently selected preset (default if none chosen). May be `null` until
   *  the API has responded. */
  activePreset: ViewPreset | null;
  /** Saves stored only under this user's key (never mixes org defaults). */
  userPresets: ViewPreset[];
  /** User has zero personal presets and at least one organisation default exists. */
  usingOrganisationFallback: boolean;
  /** Replace the entire user list (rarely needed; prefer `upsertPreset` /
   * `deletePreset`). Persists immediately. */
  savePresets: (next: ViewPreset[]) => void;
  upsertPreset: (preset: ViewPreset) => ViewPreset | null;
  deletePreset: (id: string) => void;
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

function parseBootstrap(
  data: unknown,
  legacyLocalStorageKey: string | undefined,
): ParsedBootstrap {
  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Array.isArray((data as ParsedBootstrap).user)
  ) {
    const o = data as ParsedBootstrap;
    return {
      user: o.user as ViewPreset[],
      organisation: Array.isArray(o.organisation) ? o.organisation : [],
    };
  }
  if (Array.isArray(data)) {
    return { user: data as ViewPreset[], organisation: [] };
  }
  if (legacyLocalStorageKey) {
    const legacy = readLegacyLocalStorage(legacyLocalStorageKey);
    if (legacy) return { user: legacy, organisation: [] };
  }
  return { user: [], organisation: [] };
}

export function useTableViewPresets(
  options: UseTableViewPresetsOptions,
): UseTableViewPresetsReturn {
  const { scope, legacyLocalStorageKey, normalizePreset } = options;

  const [userPresets, setUserPresets] = React.useState<ViewPreset[]>([]);
  const [organisationPresets, setOrganisationPresets] = React.useState<
    ViewPreset[]
  >([]);
  const [presetsLoaded, setPresetsLoaded] = React.useState(false);
  const [activePresetId, setActivePresetId] = React.useState<string | null>(
    null,
  );

  const userPresetsRef = React.useRef(userPresets);
  React.useEffect(() => {
    userPresetsRef.current = userPresets;
  }, [userPresets]);

  const presets = React.useMemo(
    () =>
      userPresets.length > 0 ? userPresets : organisationPresets,
    [userPresets, organisationPresets],
  );

  const usingOrganisationFallback =
    userPresets.length === 0 && organisationPresets.length > 0;

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
        let { user: userIncoming, organisation: orgIncoming } =
          parseBootstrap(data, legacyLocalStorageKey);

        const norm = normalizePreset;
        if (norm) {
          userIncoming = userIncoming
            .map((p) => norm(p))
            .filter((p): p is ViewPreset => p !== null);
          orgIncoming = orgIncoming
            .map((p) => norm(p))
            .filter((p): p is ViewPreset => p !== null);
        }

        setUserPresets(userIncoming);
        setOrganisationPresets(orgIncoming);
        setPresetsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, legacyLocalStorageKey, normalizePreset]);

  const persist = React.useCallback(
    (nextUserPresets: ViewPreset[]) => {
      setUserPresets(nextUserPresets);
      if (legacyLocalStorageKey)
        writeLegacyLocalStorage(legacyLocalStorageKey, nextUserPresets);
      fetch(apiUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextUserPresets),
      }).catch(() => {
        /* silent */
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
      const current = userPresetsRef.current;
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
      const current = userPresetsRef.current;
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
      const current = userPresetsRef.current;
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
    userPresets,
    usingOrganisationFallback,
    savePresets,
    upsertPreset,
    deletePreset,
    setDefault,
  };
}
