/**
 * Idle-timeout policy — what each user_type's "logged-in idle"
 * window looks like, and how long the warning lightbox shows
 * before automatic sign-out.
 *
 * Stored in `app_settings` under the key `idle_timeout_policy` so
 * admins can change it without a deploy (matches the
 * `dynamic-config-first` rule).
 *
 * Why per-role
 * ------------
 * - Internal staff / admin: longer idle (they walk away from
 *   their desk regularly) but still must auto-logout for
 *   compliance / shared-workstation safety.
 * - Direct clients: tighter idle since they often use shared
 *   devices (kiosks, family computers, public PCs).
 *
 * Why server-side too
 * -------------------
 * The client-side timer is the user-visible part, but the JWT
 * `maxAge` in `lib/auth/options.ts` is the *hard backstop*: even
 * if a user disables JS, the cookie expires at most after
 * `maxAge` seconds. We deliberately set `maxAge` to the
 * **largest** per-role idle limit so we don't kick people off
 * before the in-app warning has a chance to fire.
 */

export type UserTypeKey =
  | "admin"
  | "agent"
  | "internal_staff"
  | "accounting"
  | "direct_client"
  | "service_provider";

export type IdleRoleConfig = {
  /** Seconds of inactivity before the warning dialog shows. */
  idleSeconds: number;
  /** Seconds the warning dialog counts down before auto sign-out. */
  warnSeconds: number;
};

export type IdleTimeoutPolicy = {
  /** Master switch — when false, the host renders nothing. */
  enabled: boolean;
  /** Per-role configuration. Missing roles fall back to DEFAULT_ROLE_CONFIG. */
  perRole: Partial<Record<UserTypeKey, IdleRoleConfig>>;
};

/**
 * Sensible default for any role that doesn't have its own entry.
 * 30 minutes idle + 60s warning is the typical "office app"
 * profile (banks/admin dashboards land in this range).
 */
export const DEFAULT_ROLE_CONFIG: IdleRoleConfig = {
  idleSeconds: 30 * 60,
  warnSeconds: 60,
};

/**
 * Default policy used when `app_settings` has no row yet. Tightens
 * the window for client-facing roles (they often use shared/public
 * devices) and keeps the standard 30-min profile for staff.
 */
export const DEFAULT_IDLE_TIMEOUT_POLICY: IdleTimeoutPolicy = {
  enabled: true,
  perRole: {
    admin: { idleSeconds: 30 * 60, warnSeconds: 60 },
    agent: { idleSeconds: 30 * 60, warnSeconds: 60 },
    internal_staff: { idleSeconds: 30 * 60, warnSeconds: 60 },
    accounting: { idleSeconds: 30 * 60, warnSeconds: 60 },
    direct_client: { idleSeconds: 10 * 60, warnSeconds: 60 },
    service_provider: { idleSeconds: 10 * 60, warnSeconds: 60 },
  },
};

const ALL_ROLES: UserTypeKey[] = [
  "admin",
  "agent",
  "internal_staff",
  "accounting",
  "direct_client",
  "service_provider",
];

export function isUserTypeKey(value: unknown): value is UserTypeKey {
  return typeof value === "string" && (ALL_ROLES as string[]).includes(value);
}

/**
 * Return the merged config for a given role, applying defaults and
 * clamping values into safe ranges so a misconfigured row in
 * `app_settings` can never make the dialog unusable.
 */
export function resolveRoleConfig(
  policy: IdleTimeoutPolicy | undefined | null,
  userType: string | undefined | null,
): IdleRoleConfig {
  const role: UserTypeKey | null = isUserTypeKey(userType) ? userType : null;
  const raw =
    (role && policy?.perRole?.[role]) || DEFAULT_ROLE_CONFIG;
  return clampRoleConfig(raw);
}

/**
 * Clamp idle/warn seconds into safe ranges:
 *   - idleSeconds: at least 60s (otherwise users get warned almost
 *     immediately), at most 12h.
 *   - warnSeconds: at least 10s, at most 5min, and never longer
 *     than idleSeconds itself.
 */
export function clampRoleConfig(c: IdleRoleConfig): IdleRoleConfig {
  const idleSeconds = Math.max(60, Math.min(12 * 60 * 60, Math.floor(c.idleSeconds)));
  let warnSeconds = Math.max(10, Math.min(5 * 60, Math.floor(c.warnSeconds)));
  if (warnSeconds > idleSeconds) warnSeconds = Math.min(60, idleSeconds);
  return { idleSeconds, warnSeconds };
}

/**
 * Pick the longest idleSeconds across every configured role. Used
 * by the NextAuth `session.maxAge` so the cookie/JWT lives at
 * least as long as the slowest role's warning dialog needs to
 * fire — but no longer.
 *
 * Adds a small buffer (warnSeconds + 5min) so we never kick a
 * user off via cookie expiry while they are still inside the
 * client-side warning window.
 */
export function maxSessionMaxAgeSeconds(policy: IdleTimeoutPolicy): number {
  let maxIdle = DEFAULT_ROLE_CONFIG.idleSeconds;
  let maxWarn = DEFAULT_ROLE_CONFIG.warnSeconds;
  for (const r of ALL_ROLES) {
    const cfg = policy.perRole[r];
    if (!cfg) continue;
    const c = clampRoleConfig(cfg);
    if (c.idleSeconds > maxIdle) maxIdle = c.idleSeconds;
    if (c.warnSeconds > maxWarn) maxWarn = c.warnSeconds;
  }
  return maxIdle + maxWarn + 5 * 60;
}

export const ROLE_LABELS: Record<UserTypeKey, string> = {
  admin: "Admin",
  agent: "Agent",
  internal_staff: "Internal Staff",
  accounting: "Accounting",
  direct_client: "Direct Client",
  service_provider: "Service Provider",
};

export const EDITABLE_ROLES: UserTypeKey[] = [
  "admin",
  "agent",
  "internal_staff",
  "accounting",
  "direct_client",
  "service_provider",
];
