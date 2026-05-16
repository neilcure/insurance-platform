import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PoliciesTableClient from "@/components/policies/PoliciesTableClient";
import { serverFetch } from "@/lib/auth/server-fetch";
import { requireUser } from "@/lib/auth/require-user";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination/types";
import { resolvePrimaryDashboardCreatePolicyHref } from "@/lib/dashboard/resolve-create-policy-href";

type PolicyRow = { policyId: number; policyNumber: string; createdAt: string; isActive: boolean; carExtra?: Record<string, unknown> | null };

async function fetchPolicies(limit: number): Promise<{ rows: PolicyRow[]; total: number }> {
  const res = await serverFetch(`/api/policies?limit=${limit}&offset=0`);
  if (!res.ok) {
    if (res.status === 401) return { rows: [], total: 0 };
    throw new Error("Failed to load policies");
  }
  const raw = await res.json();
  const list: PolicyRow[] = Array.isArray(raw)
    ? (raw as PolicyRow[])
    : Array.isArray(raw?.rows)
      ? (raw.rows as PolicyRow[])
      : [];
  const total = Array.isArray(raw) ? list.length : Number(raw?.total ?? list.length);
  const rows = list.map((r) => ({ ...r, isActive: r.isActive !== false, carExtra: r.carExtra ?? null }));
  return { rows, total };
}

export default async function PoliciesPage() {
  const me = await requireUser();
  const isClient = me.userType === "direct_client";
  const pageSize = DEFAULT_PAGE_SIZE;
  const { rows, total } = await fetchPolicies(pageSize);
  const createPolicy = !isClient ? await resolvePrimaryDashboardCreatePolicyHref() : null;
  const createHref = createPolicy?.href ?? "/policies/new";
  const createLabel = createPolicy?.flowButtonLabel?.trim() || "New Policy";

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{isClient ? "My Policies" : "Policies"}</h1>
        {!isClient && (
          <Link href={createHref}>
            <Button size="md">{createLabel}</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isClient ? "Your Policies" : "All Policies"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {total === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              {isClient ? "No policies found linked to your account." : "No policies found."}
            </div>
          ) : (
            <PoliciesTableClient
              initialRows={rows}
              initialTotal={total}
              initialPageSize={pageSize}
              currentUserType={me.userType}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
