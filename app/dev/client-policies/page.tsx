import { serverFetch } from "@/lib/auth/server-fetch";
import { formatDDMMYYYYHHMM } from "@/lib/format/date";

type Row = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
  carExtra?: Record<string, unknown> | null;
};

export default async function ClientPoliciesDebugPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const clientId = typeof sp.clientId === "string" ? sp.clientId : "";
  const clientNumber = typeof sp.clientNumber === "string" ? sp.clientNumber : "";
  const policyNumber = typeof sp.policyNumber === "string" ? sp.policyNumber : "";
  const showExtra = sp.showExtra === "1";

  async function fetchPolicies(): Promise<Row[]> {
    const params: string[] = [];
    if (clientId) params.push(`clientId=${encodeURIComponent(clientId)}`);
    if (clientNumber) params.push(`clientNumber=${encodeURIComponent(clientNumber)}`);
    if (showExtra) params.push("include=extra");
    const qs = params.join("&");
    const res = await serverFetch(`/api/policies?${qs}`);
    if (!res.ok) return [];
    return (await res.json()) as Row[];
  }

  async function fetchOne(): Promise<Row | null> {
    if (!policyNumber || !showExtra) return null;
    const res = await serverFetch(
      `/api/policies?policyNumber=${encodeURIComponent(policyNumber)}&include=extra`,
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as Row[];
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
  }

  const [rows, one] = await Promise.all([fetchPolicies(), fetchOne()]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Client Policies Debug</h1>

      <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <div>Query</div>
        <ul className="list-inside list-disc text-neutral-600 dark:text-neutral-300">
          <li>clientId: {clientId || "-"}</li>
          <li>clientNumber: {clientNumber || "-"}</li>
          <li>policyNumber: {policyNumber || "-"}</li>
          <li>showExtra: {showExtra ? "1" : "-"}</li>
        </ul>
        <div className="mt-2 text-xs text-neutral-500">Usage:
          <div>/dev/client-policies?clientId=123</div>
          <div>/dev/client-policies?clientNumber=HIDIC000001</div>
          <div>/dev/client-policies?policyNumber=POL-...&showExtra=1</div>
        </div>
      </div>

      <section className="space-y-2">
        <div className="font-medium">Matched Policies ({rows.length})</div>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-neutral-500 dark:border-neutral-800">
            None.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2">Policy #</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.policyId} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-3 py-2 font-mono">{r.policyNumber}</td>
                    <td className="px-3 py-2 font-mono">
                      {formatDDMMYYYYHHMM(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {one ? (
        <section className="space-y-2">
          <div className="font-medium">carExtra for policyNumber={policyNumber}</div>
          <pre className="max-h-[360px] overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">
            {JSON.stringify(one.carExtra ?? null, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}

