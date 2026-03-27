import {
  Folder, UserCheck, Phone, Car, HardHat, ShieldCheck,
  UserPlus, Users, FileText, Home, Heart, Plane,
  Building2, Umbrella, Scale, DollarSign, Briefcase,
  Package, Truck, Globe, Anchor, Shield, ClipboardList,
  Stethoscope, Flame, Droplets, Ship, Landmark, Handshake,
  Receipt, AlertTriangle, BadgeCheck, Wrench,
  Send, Mail, Bell, Printer, Download, Upload,
  Eye, EyeOff, Lock, Unlock, Settings, Star,
  Calendar, Clock, MapPin, Search, Filter,
  type LucideIcon,
} from "lucide-react";

// Fast lookup for the most commonly used icons (covers popular picks + sidebar defaults).
// Icons outside this map are resolved lazily via the full library on first miss.
const ICON_MAP: Record<string, LucideIcon> = {
  "folder": Folder, "user-check": UserCheck, "phone": Phone, "car": Car,
  "hard-hat": HardHat, "shield-check": ShieldCheck, "user-plus": UserPlus,
  "users": Users, "file-text": FileText, "home": Home, "heart": Heart,
  "plane": Plane, "building-2": Building2, "umbrella": Umbrella,
  "scale": Scale, "dollar-sign": DollarSign, "briefcase": Briefcase,
  "package": Package, "truck": Truck, "globe": Globe, "anchor": Anchor,
  "shield": Shield, "clipboard-list": ClipboardList, "stethoscope": Stethoscope,
  "flame": Flame, "droplets": Droplets, "ship": Ship, "landmark": Landmark,
  "handshake": Handshake, "receipt": Receipt, "alert-triangle": AlertTriangle,
  "badge-check": BadgeCheck, "wrench": Wrench, "send": Send, "mail": Mail,
  "bell": Bell, "printer": Printer, "download": Download, "upload": Upload,
  "eye": Eye, "eye-off": EyeOff, "lock": Lock, "unlock": Unlock,
  "settings": Settings, "star": Star, "calendar": Calendar, "clock": Clock,
  "map-pin": MapPin, "search": Search, "filter": Filter,
};

let _fullLib: Record<string, LucideIcon> | null = null;

function loadFullLibSync(): Record<string, LucideIcon> {
  if (!_fullLib) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _fullLib = require("lucide-react") as Record<string, LucideIcon>;
  }
  return _fullLib;
}

function kebabToPascal(str: string): string {
  return str
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

export function getIcon(name: string | undefined | null): LucideIcon {
  if (!name) return Folder;
  const fast = ICON_MAP[name];
  if (fast) return fast;

  // Lazy fallback: resolve from full library and cache for next time
  const pascal = kebabToPascal(name);
  const lib = loadFullLibSync();
  const comp = lib[pascal];
  if (typeof comp === "function" || (typeof comp === "object" && comp !== null && "render" in comp)) {
    ICON_MAP[name] = comp as LucideIcon;
    return comp as LucideIcon;
  }
  return Folder;
}

export const POPULAR_ICON_NAMES = [
  "folder", "user-check", "phone", "car", "hard-hat", "shield-check",
  "user-plus", "users", "file-text", "home", "heart", "plane",
  "building-2", "umbrella", "scale", "dollar-sign", "briefcase",
  "package", "truck", "globe", "anchor", "shield", "clipboard-list",
  "stethoscope", "flame", "droplets", "ship", "landmark", "handshake",
  "receipt", "alert-triangle", "badge-check", "wrench",
];

export function getPopularIconNames(): string[] {
  return POPULAR_ICON_NAMES;
}
