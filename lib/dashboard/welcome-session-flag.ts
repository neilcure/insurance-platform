/**
 * One-shot "show dashboard welcome card" flag.
 *
 * Set from `/auth/signin` immediately before a successful redirect into the app.
 * Consumed by `<WelcomeCard>` on first paint — never on simple dashboard reloads.
 */

const KEY = "dashboard:showWelcomeAfterLogin";

export function markDashboardWelcomePending(): void {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* quota / private mode */
  }
}

export function peekDashboardWelcomePending(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearDashboardWelcomePending(): void {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
