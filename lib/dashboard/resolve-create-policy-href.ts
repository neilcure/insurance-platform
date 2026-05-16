import { serverFetch } from "@/lib/auth/server-fetch";

type FlowOption = {
  value: string;
  label: string;
  sortOrder: number;
  meta?: { showInDashboard?: boolean; dashboardLabel?: string } | null;
};

type FlowButtonConfig = { label: string; flow: string };

/**
 * Resolves the same `/dashboard/flows/<flow>/new` target as
 * `<FlowNewButton flowKey={…} />`, using the **first** flow that has
 * `meta.showInDashboard` (sorted by `sortOrder`) — matching the sidebar order.
 *
 * Falls back to `null` when no dashboard flow exists (caller should use a
 * legacy URL such as `/policies/new`).
 */
export async function resolvePrimaryDashboardCreatePolicyHref(): Promise<{
  href: string;
  /** Button label from client-settings `flowButtons`, if configured */
  flowButtonLabel: string | null;
} | null> {
  try {
    const [flowsRes, settingsRes] = await Promise.all([
      serverFetch("/api/form-options?groupKey=flows"),
      serverFetch("/api/admin/client-settings"),
    ]);
    if (!flowsRes.ok) return null;
    const flows = (await flowsRes.json()) as FlowOption[];
    const list = Array.isArray(flows) ? flows : [];
    const primary = list
      .filter((f) => f.meta?.showInDashboard)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (!primary?.value?.trim()) return null;

    let targetFlow = primary.value.trim();
    let flowButtonLabel: string | null = null;

    if (settingsRes.ok) {
      const data = (await settingsRes.json()) as { flowButtons?: Record<string, FlowButtonConfig> };
      const cfg = data.flowButtons?.[primary.value];
      const alt = cfg?.flow?.trim();
      if (alt) targetFlow = alt;
      const lbl = cfg?.label?.trim();
      if (lbl) flowButtonLabel = lbl;
    }

    return {
      href: `/dashboard/flows/${encodeURIComponent(targetFlow)}/new`,
      flowButtonLabel,
    };
  } catch {
    return null;
  }
}
