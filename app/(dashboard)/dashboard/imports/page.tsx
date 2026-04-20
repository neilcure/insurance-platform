import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { listBatches } from "@/lib/import/batch-service";
import { redirect } from "next/navigation";
import { DeleteBatchButton } from "@/components/imports/DeleteBatchButton";

export const dynamic = "force-dynamic";

/**
 * /dashboard/imports — history of every staged batch the caller can see.
 *
 * Admins / internal staff see all batches; others see their own. From here
 * you can drill into the review page (/dashboard/imports/[batchId]).
 */
export default async function ImportsHistoryPage() {
  const user = await requireUser();
  if (!canCreatePolicy(user)) redirect("/dashboard");

  const isStaff = user.userType === "admin" || user.userType === "internal_staff";
  const batches = await listBatches({
    createdBy: isStaff ? undefined : Number(user.id),
  });

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Imports</h1>
        <Link
          href="/dashboard/flows/policyset/new?import=1"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          + Start a new import
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent batches</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              No imports yet. Start one from the policy creation page.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">When</th>
                    <th className="border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">Flow</th>
                    <th className="border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">File</th>
                    <th className="border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">Status</th>
                    <th className="border-b border-neutral-200 px-2 py-2 text-right dark:border-neutral-800">Rows</th>
                    <th className="border-b border-neutral-200 px-2 py-2 dark:border-neutral-800"></th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900">
                      <td className="border-b border-neutral-100 px-2 py-2 align-middle dark:border-neutral-800">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td className="border-b border-neutral-100 px-2 py-2 align-middle dark:border-neutral-800">
                        <code className="text-xs">{b.flowKey}</code>
                      </td>
                      <td className="border-b border-neutral-100 px-2 py-2 align-middle dark:border-neutral-800">
                        <span className="block max-w-[24ch] truncate">{b.filename ?? "—"}</span>
                      </td>
                      <td className="border-b border-neutral-100 px-2 py-2 align-middle dark:border-neutral-800">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="border-b border-neutral-100 px-2 py-2 text-right align-middle text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
                        <span className="text-green-700 dark:text-green-400">{b.committedRows}✓</span>{" "}
                        / <span>{b.totalRows}</span>
                        {b.errorRows + b.failedRows > 0 && (
                          <span className="ml-1 text-red-700 dark:text-red-400">
                            ({b.errorRows + b.failedRows}!)
                          </span>
                        )}
                      </td>
                      <td className="border-b border-neutral-100 px-2 py-2 align-middle text-right dark:border-neutral-800">
                        <div className="flex items-center justify-end gap-1">
                          {/*
                            Cancelled batches need the ?audit=1 flag because the
                            review page server-redirects them away by default
                            (see app/(dashboard)/dashboard/imports/[batchId]/page.tsx).
                            Without the flag, clicking Open on a cancelled row
                            looked like "nothing happened" — it bounced straight
                            back here. Relabeling to "View" hints that no edits
                            are possible.
                          */}
                          <Link
                            href={
                              b.status === "cancelled"
                                ? `/dashboard/imports/${b.id}?audit=1`
                                : `/dashboard/imports/${b.id}`
                            }
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {b.status === "cancelled" ? "View" : "Open"}
                          </Link>
                          <DeleteBatchButton
                            batchId={b.id}
                            status={b.status}
                            filename={b.filename}
                            committedRows={b.committedRows}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: "default" | "secondary" | "outline" | "success" =
    status === "committed" ? "success" :
    status === "review" ? "secondary" :
    status === "committing" ? "secondary" :
    "outline";
  return <Badge variant={variant}>{status}</Badge>;
}
