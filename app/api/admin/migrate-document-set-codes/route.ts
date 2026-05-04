import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { policies } from "@/db/schema/insurance";
import { isNotNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import {
  generateDocumentNumberWithCode,
  extractSetCodeFromDocNumber,
} from "@/lib/document-number";
import type {
  DocumentStatusEntry,
  DocumentTrackingData,
} from "@/lib/types/accounting";
import type { DocumentTemplateMeta } from "@/lib/types/document-template";
import type { PdfTemplateMeta } from "@/lib/types/pdf-template";
import { updateDocumentTracking } from "@/lib/document-tracking/atomic-update";

export const dynamic = "force-dynamic";

function toTrackingKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** GET = dry run preview, add ?apply=true to execute */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const apply = url.searchParams.get("apply") === "true";
  return runMigration(!apply);
}

/** POST { dryRun?: boolean } — default true, send false to apply */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return runMigration(body.dryRun !== false);
}

async function runMigration(dryRun: boolean) {
  try {
    await requireUser();

    // 1. Load all document templates + PDF templates with group assignments
    const allTemplates = await db
      .select({
        id: formOptions.id,
        groupKey: formOptions.groupKey,
        label: formOptions.label,
        meta: formOptions.meta,
      })
      .from(formOptions)
      .where(
        sql`${formOptions.groupKey} IN ('document_templates', 'pdf_merge_templates') AND ${formOptions.isActive} = true`,
      );

    // Build tracking-key → group map (including _agent variants)
    const keyToGroup: Record<string, string> = {};
    for (const tpl of allTemplates) {
      const meta = tpl.meta as
        | DocumentTemplateMeta
        | PdfTemplateMeta
        | null;
      const group = (meta as { documentSetGroup?: string } | null)
        ?.documentSetGroup;
      if (!group) continue;

      const baseKey = toTrackingKey(tpl.label);
      keyToGroup[baseKey] = group;

      if (tpl.groupKey === "document_templates") {
        const docMeta = meta as DocumentTemplateMeta;
        if (
          docMeta.sections?.some(
            (s) => s.audience === "client" || s.audience === "agent",
          )
        ) {
          keyToGroup[baseKey + "_agent"] = group;
        }
      }
      if (
        (meta as PdfTemplateMeta & { isAgentTemplate?: boolean })
          .isAgentTemplate
      ) {
        keyToGroup[baseKey] = group;
      }
    }

    if (Object.keys(keyToGroup).length === 0) {
      return NextResponse.json({
        message:
          "No templates with documentSetGroup configured. Set groups in Admin → Document Templates first.",
        migrated: 0,
      });
    }

    // 2. Load all policies that have document_tracking
    const allPolicies = await db
      .select({
        id: policies.id,
        policyNumber: policies.policyNumber,
        documentTracking: policies.documentTracking,
      })
      .from(policies)
      .where(isNotNull(policies.documentTracking));

    const results: {
      policyId: number;
      policyNumber: string | null;
      changes: { key: string; oldNumber: string; newNumber: string }[];
    }[] = [];

    for (const policy of allPolicies) {
      const tracking =
        (policy.documentTracking as DocumentTrackingData) ?? {};
      const entriesByGroup: Record<
        string,
        { key: string; entry: DocumentStatusEntry; suffix: string }[]
      > = {};

      for (const [key, entry] of Object.entries(tracking)) {
        if (key.startsWith("_") || !entry?.documentNumber) continue;
        const group = keyToGroup[key];
        if (!group) continue;
        const suffix = key.endsWith("_agent") ? "(A)" : "";
        if (!entriesByGroup[group]) entriesByGroup[group] = [];
        entriesByGroup[group].push({
          key,
          entry: entry as DocumentStatusEntry,
          suffix,
        });
      }

      const policyChanges: {
        key: string;
        oldNumber: string;
        newNumber: string;
      }[] = [];
      // Decisions computed OUTSIDE the row lock — applied atomically below.
      const numberChanges: Record<string, string> = {};
      const groupCodes: Record<string, { code: string; year: number }> = {};

      for (const [group, entries] of Object.entries(entriesByGroup)) {
        // Find canonical code from the first client entry
        const clientEntry =
          entries.find((e) => !e.suffix) || entries[0];
        const extracted = extractSetCodeFromDocNumber(
          clientEntry.entry.documentNumber!,
        );
        if (!extracted) continue;

        const allSame = entries.every((e) => {
          const ex = extractSetCodeFromDocNumber(e.entry.documentNumber!);
          return ex && ex.code === extracted.code;
        });
        if (allSame) {
          groupCodes[group] = extracted;
          continue;
        }

        for (const e of entries) {
          const ex = extractSetCodeFromDocNumber(e.entry.documentNumber!);
          if (ex && ex.code === extracted.code) continue;

          const prefixMatch = e.entry.documentNumber!.match(
            /^(.+?)-\d{4}-\d{4,6}/,
          );
          if (!prefixMatch) continue;
          const prefix = prefixMatch[1];

          const newNumber = await generateDocumentNumberWithCode(
            prefix,
            extracted.code,
            extracted.year,
            e.suffix || undefined,
          );
          const oldNumber = e.entry.documentNumber!;
          policyChanges.push({ key: e.key, oldNumber, newNumber });
          numberChanges[e.key] = newNumber;
        }

        groupCodes[group] = extracted;
      }

      if (policyChanges.length > 0 || Object.keys(groupCodes).length > 0) {
        if (!dryRun) {
          // Apply the precomputed changes through the atomic helper.
          // We only touch the keys we decided on — concurrent user
          // edits to other doc types (or other entry fields) are
          // preserved because we re-read the live tracking under the
          // row lock.
          await updateDocumentTracking(policy.id, (current) => {
            const next: DocumentTrackingData = { ...current };
            for (const [key, newNumber] of Object.entries(numberChanges)) {
              const live = next[key] as DocumentStatusEntry | undefined;
              if (!live) continue;
              next[key] = { ...live, documentNumber: newNumber };
            }
            if (Object.keys(groupCodes).length > 0) {
              next._setCodes = { ...(current._setCodes ?? {}), ...groupCodes };
            }
            return next;
          });
        }
        if (policyChanges.length > 0) {
          results.push({
            policyId: policy.id,
            policyNumber: policy.policyNumber,
            changes: policyChanges,
          });
        }
      }
    }

    return NextResponse.json({
      dryRun,
      message: dryRun
        ? `Dry run complete. ${results.length} policies would be updated. Send POST { "dryRun": false } to apply.`
        : `Migration complete. ${results.length} policies updated.`,
      migrated: results.length,
      groups: keyToGroup,
      details: results,
    });
  } catch (err) {
    console.error("Migration error:", err);
    return NextResponse.json(
      { error: "Migration failed" },
      { status: 500 },
    );
  }
}
