import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { requireUser } from "@/lib/auth/require-user";
import { like } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Opt = { label?: string; value?: string; children?: Child[] };
type Child = {
  label?: string;
  inputType?: string;
  options?: { label?: string; value?: string }[];
  booleanChildren?: { true?: Child[]; false?: Child[] };
};

type Issue = {
  fieldId: number;
  groupKey: string;
  fieldLabel: string;
  fieldValue: string;
  path: string;
  problem: string;
  values: string[];
};

function checkOpts(
  opts: { label?: string; value?: string }[],
  path: string,
  out: string[],
): void {
  const seen = new Map<string, number>();
  for (let i = 0; i < opts.length; i++) {
    const v = opts[i].value ?? "";
    if (v === "") {
      out.push(`${path}[${i}]: empty value (label="${opts[i].label ?? ""}")`);
    }
    if (seen.has(v)) {
      out.push(
        `${path}[${i}]: duplicate value "${v}" (first at index ${seen.get(v)})`,
      );
    }
    seen.set(v, i);
  }
}

function scanChildren(children: Child[], parentPath: string, out: string[]) {
  for (let ci = 0; ci < children.length; ci++) {
    const child = children[ci];
    const cp = `${parentPath}.children[${ci}]`;
    if (Array.isArray(child.options) && child.options.length > 0) {
      checkOpts(child.options, `${cp}.options`, out);
    }
    if (child.booleanChildren) {
      for (const branch of ["true", "false"] as const) {
        const bc = child.booleanChildren[branch];
        if (Array.isArray(bc) && bc.length > 0) {
          scanChildren(bc, `${cp}.booleanChildren.${branch}`, out);
        }
      }
    }
  }
}

export async function GET() {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(formOptions)
    .where(like(formOptions.groupKey, "%_fields"));

  const issues: Issue[] = [];

  for (const row of rows) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const problems: string[] = [];

    if (Array.isArray(meta.options)) {
      const opts = meta.options as Opt[];
      checkOpts(opts, "meta.options", problems);

      for (let oi = 0; oi < opts.length; oi++) {
        if (Array.isArray(opts[oi].children) && opts[oi].children!.length > 0) {
          scanChildren(
            opts[oi].children!,
            `meta.options[${oi}](${opts[oi].value})`,
            problems,
          );
        }
      }
    }

    if (meta.booleanChildren && typeof meta.booleanChildren === "object") {
      const bc = meta.booleanChildren as { true?: Child[]; false?: Child[] };
      for (const branch of ["true", "false"] as const) {
        if (Array.isArray(bc[branch]) && bc[branch]!.length > 0) {
          scanChildren(bc[branch]!, `meta.booleanChildren.${branch}`, problems);
        }
      }
    }

    if (problems.length > 0) {
      issues.push({
        fieldId: row.id,
        groupKey: row.groupKey,
        fieldLabel: row.label,
        fieldValue: row.value,
        path: problems.join("; "),
        problem: problems.length === 1 ? "single" : `${problems.length} issues`,
        values: problems,
      });
    }
  }

  return NextResponse.json({
    scanned: rows.length,
    issueCount: issues.length,
    issues,
    message:
      issues.length === 0
        ? "No duplicate or empty option values found. The console error may be from a stale cache — try restarting the dev server."
        : "Fields with duplicate/empty option values found. Fix them in Admin > Policy Settings > [package] > Fields.",
  });
}
