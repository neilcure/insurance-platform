import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PoliciesTableClient from "@/components/policies/PoliciesTableClient";
import { serverFetch } from "@/lib/auth/server-fetch";
import { requireUser } from "@/lib/auth/require-user";

type PolicyRow = { policyId: number; policyNumber: string; createdAt: string; isActive: boolean; carExtra?: Record<string, unknown> | null };

async function fetchPolicies(): Promise<PolicyRow[]> {
  const res = await serverFetch("/api/policies");
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Failed to load policies");
  }
  const raw = (await res.json()) as PolicyRow[];
  return raw.map((r) => ({ ...r, isActive: r.isActive !== false, carExtra: r.carExtra ?? null }));
}

export default async function PoliciesPage() {
  const me = await requireUser();
  const isClient = me.userType === "direct_client";
  const rows = await fetchPolicies();

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{isClient ? "My Policies" : "Policies"}</h1>
        {!isClient && (
          <Link href="/policies/new">
            <Button size="md">New Policy</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isClient ? "Your Policies" : "All Policies"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              {isClient ? "No policies found linked to your account." : "No policies found."}
            </div>
          ) : (
            <PoliciesTableClient initialRows={rows} currentUserType={me.userType} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

