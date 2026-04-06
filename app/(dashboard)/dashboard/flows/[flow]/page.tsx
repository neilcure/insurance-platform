import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PoliciesTableClient from "@/components/policies/PoliciesTableClient";
import { FlowNewButton } from "@/components/flows/FlowNewButton";
import { serverFetch } from "@/lib/auth/server-fetch";
import { getDisplayNameFromSnapshot } from "@/lib/field-resolver";

type PolicyRowRaw = {
  policyId: number;
  policyNumber: string;
  recordId?: number;
  recordNumber?: string;
  flowKey?: string | null;
  createdAt: string;
  isActive?: boolean;
  carExtra?: Record<string, unknown> | null;
};
type PolicyRow = { policyId: number; policyNumber: string; recordId?: number; recordNumber?: string; flowKey?: string | null; createdAt: string; isActive: boolean; displayName?: string; carExtra?: Record<string, unknown> | null };

type FlowOption = {
  id: number;
  label: string;
  value: string;
  meta?: { showInDashboard?: boolean; icon?: string; dashboardLabel?: string } | null;
};

function extractDisplayName(extra: Record<string, unknown> | null | undefined): string {
  if (!extra) return "";
  return getDisplayNameFromSnapshot({
    insuredSnapshot: extra.insuredSnapshot as Record<string, unknown> | null | undefined,
    packagesSnapshot: extra.packagesSnapshot as Record<string, unknown> | undefined,
  });
}

async function fetchPolicies(flowKey: string): Promise<PolicyRow[]> {
  const res = await serverFetch(`/api/policies?flow=${encodeURIComponent(flowKey)}`);
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Failed to load policies");
  }
  const raw = (await res.json()) as PolicyRowRaw[];
  return raw.map((r) => ({
    policyId: r.policyId,
    policyNumber: r.policyNumber,
    recordId: r.recordId ?? r.policyId,
    recordNumber: r.recordNumber ?? r.policyNumber,
    flowKey: r.flowKey ?? null,
    createdAt: r.createdAt,
    isActive: r.isActive !== false,
    displayName: extractDisplayName(r.carExtra),
    carExtra: r.carExtra ?? null,
  }));
}

async function fetchFlowInfo(flowKey: string): Promise<FlowOption | null> {
  const res = await serverFetch(`/api/form-options?groupKey=flows`);
  if (!res.ok) return null;
  const rows = (await res.json()) as FlowOption[];
  return rows.find((r) => r.value === flowKey) ?? null;
}

export default async function FlowDashboardPage({
  params,
}: {
  params: Promise<{ flow: string }>;
}) {
  const { flow } = await params;
  const [flowInfo, rows] = await Promise.all([fetchFlowInfo(flow), fetchPolicies(flow)]);

  const title = flowInfo?.meta?.dashboardLabel || flowInfo?.label || flow;

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <FlowNewButton flowKey={flow} defaultLabel={`New ${title}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All {title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              No records found.
            </div>
          ) : (
            <PoliciesTableClient initialRows={rows} entityLabel={title} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
