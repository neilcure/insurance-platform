import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import AgentsTableClient from "@/components/agents/AgentsTableClient";
import { serverFetch } from "@/lib/auth/server-fetch";

type AgentRow = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
};

async function fetchAgents(): Promise<AgentRow[]> {
  const res = await serverFetch("/api/agents");
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("Failed to load agents");
  }
  return (await res.json()) as AgentRow[];
}

export default async function AgentsPage() {
  const rows = await fetchAgents();

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
        <CardContent>{rows.length === 0 ? <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">No agents found.</div> : <AgentsTableClient initialRows={rows} />}</CardContent>
      </Card>
    </main>
  );
}

