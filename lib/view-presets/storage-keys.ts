/** `app_settings.key` for per-user saved table views. */
export function userViewPresetsStorageKey(userId: string | number, scope: string) {
  return `view_presets:user:${userId}:${scope}`;
}

/** `app_settings.key` for organisation-wide defaults (used when a user has no saved views). */
export function orgViewPresetsStorageKey(orgId: string | number, scope: string) {
  return `view_presets:org:${orgId}:${scope}`;
}
