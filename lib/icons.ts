import * as LucideIcons from "lucide-react";
import { Folder } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const SKIP = new Set([
  "createLucideIcon", "icons", "default", "Icon",
  "createElement", "toKebabCase", "mergeClasses",
]);

function isIconComponent(key: string, val: unknown): val is LucideIcon {
  if (SKIP.has(key)) return false;
  if (key.endsWith("Icon")) return false;
  if (key.startsWith("Lucide")) return false;
  if (!/^[A-Z]/.test(key)) return false;
  if (typeof val === "function") return true;
  if (typeof val === "object" && val !== null && "render" in val) return true;
  return false;
}

function pascalToKebab(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function kebabToPascal(str: string): string {
  return str
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

const allIcons = LucideIcons as unknown as Record<string, LucideIcon>;

export function getIcon(name: string | undefined | null): LucideIcon {
  if (!name) return Folder;
  const pascal = kebabToPascal(name);
  const comp = allIcons[pascal];
  if (comp && isIconComponent(pascal, comp)) return comp;
  return Folder;
}

type IconEntry = { kebab: string; pascal: string; icon: LucideIcon };

let _allIcons: IconEntry[] | null = null;

export function getAllIcons(): IconEntry[] {
  if (!_allIcons) {
    const seen = new Set<string>();
    _allIcons = [];
    for (const k of Object.keys(allIcons)) {
      if (!isIconComponent(k, allIcons[k])) continue;
      const kebab = pascalToKebab(k);
      if (seen.has(kebab)) continue;
      seen.add(kebab);
      _allIcons.push({ kebab, pascal: k, icon: allIcons[k] });
    }
    _allIcons.sort((a, b) => a.kebab.localeCompare(b.kebab));
  }
  return _allIcons;
}

const POPULAR_ICONS = [
  "folder", "user-check", "phone", "car", "hard-hat", "shield-check",
  "user-plus", "users", "file-text", "home", "heart", "plane",
  "building-2", "umbrella", "scale", "dollar-sign", "briefcase",
  "package", "truck", "globe", "anchor", "shield", "clipboard-list",
  "stethoscope", "flame", "droplets", "ship", "landmark", "handshake",
  "receipt", "alert-triangle", "badge-check", "wrench",
];

export function getPopularIconNames(): string[] {
  return POPULAR_ICONS;
}
