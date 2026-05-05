import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PoliciesTableClient from "@/components/policies/PoliciesTableClient";
import { FlowNewButton } from "@/components/flows/FlowNewButton";
import { ImportPoliciesButton } from "@/components/flows/ImportPoliciesButton";
import { serverFetch } from "@/lib/auth/server-fetch";
import { getDisplayNameFromSnapshot } from "@/lib/field-resolver";
import { requireUser } from "@/lib/auth/require-user";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination/types";

const IMPORT_ENABLED_FLOWS = new Set(["policyset"]);

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

async function fetchPolicies(flowKey: string, limit: number): Promise<{ rows: PolicyRow[]; total: number }> {
  const res = await serverFetch(
    `/api/policies?flow=${encodeURIComponent(flowKey)}&limit=${limit}&offset=0`,
  );
  if (!res.ok) {
    if (res.status === 401) return { rows: [], total: 0 };
    throw new Error("Failed to load policies");
  }
  const raw = await res.json();
  const list: PolicyRowRaw[] = Array.isArray(raw)
    ? (raw as PolicyRowRaw[])
    : Array.isArray(raw?.rows)
      ? (raw.rows as PolicyRowRaw[])
      : [];
  const total = Array.isArray(raw) ? list.length : Number(raw?.total ?? list.length);
  const rows = list.map((r) => ({
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
  return { rows, total };
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
  const pageSize = DEFAULT_PAGE_SIZE;
  const [flowInfo, policiesPage, currentUser] = await Promise.all([
    fetchFlowInfo(flow),
    fetchPolicies(flow, pageSize),
    requireUser().catch(() => null),
  ]);
  const { rows, total } = policiesPage;

  const title = flowInfo?.meta?.dashboardLabel || flowInfo?.label || flow;
  const canImport =
    IMPORT_ENABLED_FLOWS.has(flow) &&
    (currentUser?.userType === "admin" || currentUser?.userType === "internal_staff");

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          {canImport && <ImportPoliciesButton flowKey={flow} flowLabel={title} />}
          <FlowNewButton flowKey={flow} defaultLabel={`New ${title}`} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All {title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {total === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              No records found.
            </div>
          ) : (
            <PoliciesTableClient
              initialRows={rows}
              initialTotal={total}
              initialPageSize={pageSize}
              entityLabel={title}
              flowKey={flow}
              currentUserType={currentUser?.userType}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
