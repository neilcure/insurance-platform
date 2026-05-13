import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";

const SETTINGS_KEY = "accounting_display_columns";

/**
 * One row in the Record Display Settings panel.
 *
 * Each row corresponds to ONE column in the main Accounting table.
 * `enabled=false` hides the column entirely. The array order
 * determines the visual column order in the table (index 0 is
 * leftmost). Re-ordering happens client-side via up/down arrows in
 * the panel; the new array is PUT back here verbatim.
 *
 * There is intentionally NO "always visible" column — the user
 * explicitly asked that if every column is disabled, the table
 * shows no columns. Don't add fallback logic in callers.
 */
export type AccountingDisplayColumn = {
  key: string;
  label: string;
  enabled: boolean;
};

/**
 * Canonical, full list of every column the table knows how to
 * render. The page-level column registry MUST have a renderer for
 * each `key` here — when adding a new column, update both this
 * array AND `COLUMN_REGISTRY` in `app/(dashboard)/dashboard/accounting/page.tsx`.
 */
export const DEFAULT_COLUMNS: AccountingDisplayColumn[] = [
  { key: "invoiceDate", label: "Date", enabled: true },
  { key: "invoiceNumber", label: "Document", enabled: true },
  { key: "type", label: "Type", enabled: true },
  { key: "insuredName", label: "Insured", enabled: true },
  { key: "plate", label: "Vehicle Plate", enabled: true },
  { key: "agentName", label: "Agent", enabled: false },
  { key: "clientName", label: "Client Name", enabled: false },
  { key: "policyNumber", label: "Policy", enabled: true },
  { key: "direction", label: "Direction", enabled: false },
  { key: "entityType", label: "Entity Type", enabled: false },
  { key: "premiumType", label: "Premium Type", enabled: false },
  { key: "notes", label: "Notes", enabled: false },
  { key: "quotationNo", label: "Quotation No.", enabled: false },
  { key: "receiptNo", label: "Receipt No.", enabled: false },
  { key: "dueDate", label: "Due Date", enabled: false },
  { key: "remaining", label: "Outstanding", enabled: true },
  { key: "total", label: "Total", enabled: true },
  { key: "status", label: "Status", enabled: true },
];

/**
 * Merge a saved settings array with `DEFAULT_COLUMNS` so callers
 * always see EVERY known column key. New columns added in code show
 * up at the end of the user's saved order with their default
 * `enabled` value — without this, a user who saved settings before
 * we added a column would never see that column in the panel.
 */
function mergeWithDefaults(saved: AccountingDisplayColumn[] | null): AccountingDisplayColumn[] {
  if (!saved || !Array.isArray(saved)) return DEFAULT_COLUMNS;
  const savedByKey = new Map(saved.map((c) => [c.key, c]));
  const knownKeys = new Set(DEFAULT_COLUMNS.map((c) => c.key));
  // Keep saved order for everything the user explicitly ordered
  // (filter out anything we no longer support).
  const ordered = saved.filter((c) => knownKeys.has(c.key));
  // Append any newly-added columns the user hasn't seen yet.
  for (const def of DEFAULT_COLUMNS) {
    if (!savedByKey.has(def.key)) {
      ordered.push(def);
    }
  }
  // Refresh labels from defaults so renaming a column in code
  // shows up immediately (the user only owns key + enabled +
  // position; labels are owned by the code).
  return ordered.map((c) => ({
    key: c.key,
    label: DEFAULT_COLUMNS.find((d) => d.key === c.key)?.label ?? c.label,
    enabled: c.enabled,
  }));
}

export async function GET() {
  try {
    await requireUser();
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SETTINGS_KEY))
      .limit(1);

    const saved = (row?.value ?? null) as AccountingDisplayColumn[] | null;
    return NextResponse.json({ columns: mergeWithDefaults(saved) });
  } catch {
    return NextResponse.json({ columns: DEFAULT_COLUMNS });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { columns } = (await request.json()) as { columns: AccountingDisplayColumn[] };
    if (!Array.isArray(columns)) {
      return NextResponse.json({ error: "columns must be an array" }, { status: 400 });
    }

    // Allow the user to save ANY ordering / enabled flag, but only
    // for known column keys. Unknown keys are dropped silently so a
    // bad client can't poison the settings.
    const knownKeys = new Set(DEFAULT_COLUMNS.map((c) => c.key));
    const cleaned = columns
      .filter((c) => c && typeof c.key === "string" && knownKeys.has(c.key))
      .map((c) => ({
        key: c.key,
        label: DEFAULT_COLUMNS.find((d) => d.key === c.key)?.label ?? c.key,
        enabled: Boolean(c.enabled),
      }));

    await db
      .insert(appSettings)
      .values({ key: SETTINGS_KEY, value: cleaned as any })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: cleaned as any },
      });

    return NextResponse.json({ columns: cleaned });
  } catch (err) {
    console.error("PUT /api/admin/accounting-display error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
