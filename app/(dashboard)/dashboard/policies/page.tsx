import { cookies } from "next/headers";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PoliciesTableClient from "@/components/policies/PoliciesTableClient";

type PolicyRow = { policyId: number; policyNumber: string; createdAt: string };

async function fetchPolicies(): Promise<PolicyRow[]> {
  const cookieStore = (await (cookies() as unknown as Promise<ReturnType<typeof cookies>>)) as any;
  const cookieHeader = cookieStore
    .getAll()
    .map((c: { name: string; value: string }) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  const base = process.env.NEXTAUTH_URL ?? "";
  const res = await fetch(`${base}/api/policies`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) {
      // handled by layout redirect, but keep a guard
      return [];
    }
    throw new Error("Failed to load policies");
  }
  return (await res.json()) as PolicyRow[];
}

export default async function PoliciesPage() {
  const rows = await fetchPolicies();
  const formatDDMMYYYY = (iso: string) => {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Policies</h1>
        <Link href="/policies/new">
          <Button size="md">New Policy</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Policies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              No policies found.
            </div>
          ) : (
            <PoliciesTableClient initialRows={rows} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

