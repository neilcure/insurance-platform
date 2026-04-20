import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { getBatchOrThrow, getBatchRows } from "@/lib/import/batch-service";
import { loadFlowImportSchema, flattenFields } from "@/lib/import/schema";
import { fieldColumnId } from "@/lib/import/excel";
import BatchReviewClient from "@/components/imports/BatchReviewClient";

export const dynamic = "force-dynamic";

/**
 * /dashboard/imports/[batchId] — the staging-area review page.
 *
 * Server component: loads the batch + rows + flow schema, then hands off to
 * the client component for interactive review (filters, inline edit, bulk
 * skip, commit).
 */
export default async function BatchReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ audit?: string }>;
}) {
  const user = await requireUser();
  if (!canCreatePolicy(user)) redirect("/dashboard");

  const { batchId } = await params;
  const { audit } = await searchParams;
  const id = Number(batchId);
  if (!Number.isFinite(id)) notFound();

  let batch;
  try {
    batch = await getBatchOrThrow(id);
  } catch {
    notFound();
  }

  const isStaff = user.userType === "admin" || user.userType === "internal_staff";
  if (!isStaff && batch.createdBy !== Number(user.id)) {
    redirect("/dashboard/imports");
  }

  // Cancelled batches have no actionable controls on the review page — every
  // button is hidden because `isLocked` is true. Bouncing the user back to
  // the imports list (where they can see the cancelled status badge + start
  // a fresh import) avoids the dead-end "why is nothing happening?" screen.
  // `?audit=1` lets staff inspect a cancelled batch's rows when needed.
  if (batch.status === "cancelled" && audit !== "1") {
    redirect("/dashboard/imports");
  }

  // Load the flow schema so the client component can render the right
  // column labels and (later) inline-edit the right inputs.
  const schema = await loadFlowImportSchema(batch.flowKey);
  const fields = flattenFields(schema);
  const columns = fields.map((f) => ({
    id: fieldColumnId(f),
    label: f.label,
    inputType: f.inputType,
    required: f.required,
    pkg: f.pkg,
    options: f.options.slice(0, 200), // cap to keep payload small
    isVirtual: !!f.virtual,
    // Only the flow key is needed client-side — mapping logic stays server-only.
    // `__agent__` triggers the agent picker; anything else uses the entity picker.
    entityPicker: f.entityPicker ? { flow: f.entityPicker.flow } : undefined,
  }));

  const rows = await getBatchRows(id);

  return (
    <main className="mx-auto max-w-[1400px]">
      <BatchReviewClient
        initialBatch={JSON.parse(JSON.stringify(batch))}
        initialRows={JSON.parse(JSON.stringify(rows))}
        columns={columns}
      />
    </main>
  );
}
