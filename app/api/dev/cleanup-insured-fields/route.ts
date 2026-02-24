import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

type Row = { id: number; value: string; isActive: boolean | null };

function stripInsuredPrefixes(raw: string): string {
  let v = String(raw ?? "").trim();
  // Strip repeatedly (handles insured__insured__foo etc). Case-insensitive.
  for (let i = 0; i < 10; i++) {
    const lower = v.toLowerCase();
    if (lower.startsWith("insured__")) v = v.slice("insured__".length).trim();
    else if (lower.startsWith("insured_")) v = v.slice("insured_".length).trim();
    else break;
  }
  return v;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      dryRun?: boolean;
      deactivateDuplicates?: boolean;
    };
    const dryRun = Boolean(body?.dryRun);
    const deactivateDuplicates = typeof body?.deactivateDuplicates === "boolean" ? body.deactivateDuplicates : true;

    const res = await db.execute(
      sql`select "id", "value", "is_active" as "isActive" from "form_options" where "group_key" = 'insured_fields' order by "id" asc`,
    );
    const rows: Row[] = Array.isArray((res as any)?.rows) ? ((res as any).rows as Row[]) : (res as unknown as Row[]);

    // Group by lowercased base key to catch casing + prefix variants.
    const groups = new Map<string, { base: string; rows: (Row & { base: string })[] }>();
    for (const r of rows ?? []) {
      const base = stripInsuredPrefixes(String(r?.value ?? ""));
      const key = base.trim().toLowerCase();
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { base, rows: [] });
      groups.get(key)!.rows.push({ ...r, base });
    }

    const updates: { id: number; from: string; to: string }[] = [];
    const deactivated: { id: number; value: string; base: string; reason: string }[] = [];
    let skippedEmpty = 0;

    const score = (r: Row & { base: string }) => {
      const original = String(r.value ?? "").trim();
      const base = String(r.base ?? "").trim();
      const lower = original.toLowerCase();
      const isExact = original === base;
      const startsDbl = lower.startsWith("insured__");
      const startsSgl = lower.startsWith("insured_");
      const active = r.isActive === true ? 10 : 0;
      const shape = isExact ? 100 : startsDbl ? 80 : startsSgl ? 70 : 50;
      return shape + active;
    };

    for (const [, g] of groups.entries()) {
      const bucket = g.rows;
      if (!Array.isArray(bucket) || bucket.length === 0) continue;
      // Pick a winner we will normalize to the base key.
      const sorted = [...bucket].sort((a, b) => {
        const sa = score(a);
        const sb = score(b);
        if (sb !== sa) return sb - sa;
        return Number(b.id) - Number(a.id);
      });
      const winner = sorted[0]!;
      const target = String(winner.base ?? "").trim();
      if (!target) {
        skippedEmpty += 1;
        continue;
      }

      // Update winner value if needed.
      if (String(winner.value ?? "").trim() !== target) {
        updates.push({ id: Number(winner.id), from: String(winner.value ?? ""), to: target });
        if (!dryRun) {
          await db.execute(sql`update "form_options" set "value" = ${target} where "id" = ${Number(winner.id)}`);
        }
      }

      // Handle duplicates: deactivate (preferred) to avoid having multiple rows for the same key.
      if (sorted.length > 1 && deactivateDuplicates) {
        for (const dup of sorted.slice(1)) {
          // If already inactive, just report.
          if (dup.isActive !== true) {
            deactivated.push({
              id: Number(dup.id),
              value: String(dup.value ?? ""),
              base: String(dup.base ?? ""),
              reason: "duplicate (already inactive)",
            });
            continue;
          }
          deactivated.push({
            id: Number(dup.id),
            value: String(dup.value ?? ""),
            base: String(dup.base ?? ""),
            reason: `duplicate of id ${Number(winner.id)}`,
          });
          if (!dryRun) {
            await db.execute(sql`update "form_options" set "is_active" = false where "id" = ${Number(dup.id)}`);
          }
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        dryRun,
        scanned: Array.isArray(rows) ? rows.length : 0,
        updated: updates.length,
        deactivated: deactivated.length,
        skippedEmpty,
        sample: {
          updates: updates.slice(0, 50),
          deactivated: deactivated.slice(0, 50),
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
