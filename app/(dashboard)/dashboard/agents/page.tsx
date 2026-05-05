import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import AgentsTableClient from "@/components/agents/AgentsTableClient";
import { serverFetch } from "@/lib/auth/server-fetch";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination/types";

type AgentRow = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
};

async function fetchAgents(limit: number): Promise<{ rows: AgentRow[]; total: number }> {
  const res = await serverFetch(`/api/agents?limit=${limit}&offset=0`);
  if (!res.ok) {
    if (res.status === 401) return { rows: [], total: 0 };
    throw new Error("Failed to load agents");
  }
  const raw = await res.json();
  const rows: AgentRow[] = Array.isArray(raw)
    ? (raw as AgentRow[])
    : Array.isArray(raw?.rows)
      ? (raw.rows as AgentRow[])
      : [];
  const total = Array.isArray(raw) ? rows.length : Number(raw?.total ?? rows.length);
  return { rows, total };
}

export default async function AgentsPage() {
  const pageSize = DEFAULT_PAGE_SIZE;
  const { rows, total } = await fetchAgents(pageSize);

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Agents</h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>All Agents</CardTitle>
            <Link href="/admin/users">
              <Button>Create / Edit Agent</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {total === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              No agents found.
            </div>
          ) : (
            <AgentsTableClient
              initialRows={rows}
              initialTotal={total}
              initialPageSize={pageSize}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
