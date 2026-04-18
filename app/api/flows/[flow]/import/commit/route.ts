import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { loadFlowImportSchema } from "@/lib/import/schema";
import { parseImportWorkbook } from "@/lib/import/excel";
import { validateRows } from "@/lib/import/validate";
import { buildPolicyPayload } from "@/lib/import/payload";
import { resolveOrCreateClient } from "@/lib/import/client-resolver";
import { EntityResolutionCache, applyEntityReferences } from "@/lib/import/entity-resolver";
import { serverFetch } from "@/lib/auth/server-fetch";

export const runtime = "nodejs";

const MAX_ROWS = 500;

const DEFAULT_CLIENT_FLOW_KEY = "clientSet";

export type CommitRowResult = {
  excelRow: number;
  ok: boolean;
  /** Created policy id (when ok) */
  policyId?: number;
  /** Created policy number (when ok) */
  policyNumber?: string;
  /** True if a new client-policy was auto-created for this row */
  clientCreated?: boolean;
  /** Resolved client number used for the policy */
  clientNumber?: string;
  /** Error message if the row failed */
  error?: string;
};

export type CommitResponse = {
  flow: string;
  total: number;
  succeeded: number;
  failed: number;
  results: CommitRowResult[];
};

/**
 * POST /api/flows/[flow]/import/commit
 *
 * Accepts the same multipart upload as /preview, re-validates server-side,
 * and creates one policy per valid row by invoking the existing internal
 * POST /api/policies endpoint. Rows with validation errors are skipped and
 * reported back. Rows are processed sequentially to keep error reporting
 * deterministic and to avoid spiking concurrent connections.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ flow: string }> },
) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { flow } = await params;
    if (!flow) {
      return NextResponse.json({ error: "Missing flow key" }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing file field." },
        { status: 400 },
      );
    }

    const clientFlowKeyRaw = form.get("clientFlowKey");
    const clientFlowKey =
      typeof clientFlowKeyRaw === "string" && clientFlowKeyRaw.trim()
        ? clientFlowKeyRaw.trim()
        : DEFAULT_CLIENT_FLOW_KEY;

    const buffer = Buffer.from(await file.arrayBuffer());
    const schema = await loadFlowImportSchema(flow);
    if (schema.packages.length === 0) {
      return NextResponse.json(
        { error: `No fields configured for flow "${flow}"` },
        { status: 404 },
      );
    }

    const parsed = await parseImportWorkbook(buffer, schema);
    if (parsed.rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows: ${parsed.rows.length}. Max is ${MAX_ROWS}.` },
        { status: 413 },
      );
    }

    const validated = validateRows(parsed.rows, schema);

    const results: CommitRowResult[] = [];
    let succeeded = 0;
    let failed = 0;
    // One cache per import batch — same insurer / collaborator referenced by
    // many rows is looked up only once.
    const entityCache = new EntityResolutionCache();

    for (const row of validated) {
      const baseResult: CommitRowResult = { excelRow: row.excelRow, ok: false };

      if (row.errors.length > 0) {
        results.push({
          ...baseResult,
          error: row.errors
            .map((e) => (e.column ? `${e.column}: ${e.message}` : e.message))
            .join("; "),
        });
        failed++;
        continue;
      }

      try {
        const { payload, clientNumber, agentNumber, entityRefs } = buildPolicyPayload(row, schema);

        // Resolve all entity-picker / agent-picker references first. If any
        // referenced record doesn't exist, fail the row with a clear message
        // (the user picked "fail" over "auto-create" for missing references).
        const refsForResolution = [...entityRefs];
        if (agentNumber) {
          refsForResolution.push({
            scope: "package",
            pkg: "policy",
            columnId: "policy.agentNumber",
            fullKey: "policy__agentNumber",
            refFlow: "__agent__",
            refValue: agentNumber,
            mappings: [],
          });
        }
        const refErrors = await applyEntityReferences(payload, refsForResolution, entityCache);
        if (refErrors.length > 0) {
          throw new Error(refErrors.map((e) => `${e.columnId}: ${e.message}`).join("; "));
        }

        // Resolve / auto-create the client (clientSet-flow policy)
        let resolvedClientNumber: string | undefined;
        let clientCreated = false;
        if (Object.keys(payload.insured).length > 0 || clientNumber) {
          const resolved = await resolveOrCreateClient({
            clientNumber,
            insured: payload.insured,
            clientFlowKey,
          });
          payload.insured.clientPolicyId = resolved.clientPolicyId;
          payload.insured.clientPolicyNumber = resolved.clientPolicyNumber;
          payload.policy = {
            ...(payload.policy ?? {}),
            ...({ clientId: resolved.clientPolicyId } as Record<string, unknown>),
          };
          resolvedClientNumber = resolved.clientPolicyNumber;
          clientCreated = resolved.created;
        }

        const res = await serverFetch("/api/policies", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          policyId?: number;
          recordId?: number;
          policyNumber?: string;
          recordNumber?: string;
        };
        if (!res.ok) {
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }

        const policyId = Number(body.recordId ?? body.policyId ?? 0);
        const policyNumber = String(body.recordNumber ?? body.policyNumber ?? "");

        results.push({
          ...baseResult,
          ok: true,
          policyId: Number.isFinite(policyId) && policyId > 0 ? policyId : undefined,
          policyNumber: policyNumber || undefined,
          clientNumber: resolvedClientNumber,
          clientCreated,
        });
        succeeded++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({ ...baseResult, error: message });
        failed++;
      }
    }

    const response: CommitResponse = {
      flow,
      total: validated.length,
      succeeded,
      failed,
      results,
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
