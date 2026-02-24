import { cookies } from "next/headers";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ClientsTableClient from "@/components/clients/ClientsTableClient";

type ClientRow = {
  id: number;
  clientNumber: string;
  category: string;
  displayName: string;
  primaryId: string;
  contactPhone: string | null;
  isActive: boolean;
  createdAt: string;
};

async function fetchClients(): Promise<ClientRow[]> {
  const cookieStore = (await (cookies() as unknown as Promise<ReturnType<typeof cookies>>)) as any;
  const cookieHeader = cookieStore
    .getAll()
    .map((c: { name: string; value: string }) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  const base = process.env.NEXTAUTH_URL ?? "";
  const res = await fetch(`${base}/api/clients`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) {
      return [];
    }
    throw new Error("Failed to load clients");
  }
  return (await res.json()) as ClientRow[];
}

export default async function ClientsPage() {
  const rows = await fetchClients();
  const formatDDMMYYYY = (iso: string) => {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Clients</h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>All Clients</CardTitle>
            <Link href="/policies/new?intent=create_client">
              <Button>Create New Client</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              No clients found.
            </div>
          ) : (
            <ClientsTableClient initialRows={rows} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}


