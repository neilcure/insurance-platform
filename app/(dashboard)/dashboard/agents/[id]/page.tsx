import { cookies } from "next/headers";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Agent = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  userType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
};

async function fetchAgent(id: number): Promise<Agent | null> {
  const cookieStore = (await (cookies() as unknown as Promise<ReturnType<typeof cookies>>));
  const cookieHeader = cookieStore
    .getAll()
    .map((c: { name: string; value: string }) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  const base = process.env.NEXTAUTH_URL ?? "";
  const res = await fetch(`${base}/api/agents/${id}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as Agent;
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  const agent = await fetchAgent(agentId);

  return (
    <main className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Agent Details</h1>
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/agents/${agentId}/logs`}>
            <Button variant="secondary">View Logs</Button>
          </Link>
          <Link href="/dashboard/agents">
            <Button>Back to Agents</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {agent ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500">Agent No.</div>
                <div className="col-span-2">
                  <span className={agent.isActive ? "text-green-600 dark:text-green-400 font-mono" : "text-neutral-500 dark:text-neutral-400 font-mono"}>
                    {agent.userNumber ?? "—"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500">Name</div>
                <div className="col-span-2">{agent.name ?? "—"}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500">Email</div>
                <div className="col-span-2">{agent.email}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500">Role</div>
                <div className="col-span-2 capitalize">{agent.userType}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500">Status</div>
                <div className="col-span-2">{agent.isActive ? "Active" : "Inactive"}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500">Created</div>
                <div className="col-span-2">{new Date(agent.createdAt).toLocaleString()}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500">Updated</div>
                <div className="col-span-2">{agent.updatedAt ? new Date(agent.updatedAt).toLocaleString() : "—"}</div>
              </div>
            </>
          ) : (
            <div className="text-neutral-600 dark:text-neutral-400">Not found or no access.</div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

