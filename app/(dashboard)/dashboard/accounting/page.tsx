import { serverFetch } from "@/lib/auth/server-fetch";
import { AccountingPageClient } from "@/components/accounting/AccountingPageClient";

type FlowOption = {
  id: number;
  label: string;
  value: string;
  meta?: { dashboardLabel?: string } | null;
};

async function fetchFlows(): Promise<FlowOption[]> {
  try {
    const res = await serverFetch("/api/form-options?groupKey=flows");
    if (!res.ok) return [];
    return (await res.json()) as FlowOption[];
  } catch {
    return [];
  }
}

export default async function AccountingPage() {
  const flows = await fetchFlows();
  const flowOptions = flows.map((f) => ({
    value: f.value,
    label: f.meta?.dashboardLabel || f.label,
  }));

  return (
    <main className="mx-auto max-w-7xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounting</h1>
      </div>
      <AccountingPageClient flowOptions={flowOptions} />
    </main>
  );
}
