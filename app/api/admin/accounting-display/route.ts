import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";

const SETTINGS_KEY = "accounting_display_columns";

export type AccountingDisplayColumn = {
  key: string;
  label: string;
  enabled: boolean;
};

export const DEFAULT_COLUMNS: AccountingDisplayColumn[] = [
  { key: "invoiceNumber", label: "Invoice No.", enabled: true },
  { key: "clientName", label: "Client Name", enabled: true },
  { key: "policyNumber", label: "Policy No.", enabled: true },
  { key: "direction", label: "Direction", enabled: true },
  { key: "entityType", label: "Entity Type", enabled: false },
  { key: "premiumType", label: "Premium Type", enabled: false },
  { key: "notes", label: "Notes", enabled: true },
  { key: "agentName", label: "Agent", enabled: true },
  { key: "quotationNo", label: "Quotation No.", enabled: true },
  { key: "receiptNo", label: "Receipt No.", enabled: true },
  { key: "invoiceDate", label: "Invoice Date", enabled: true },
  { key: "dueDate", label: "Due Date", enabled: false },
  { key: "remaining", label: "Remaining", enabled: true },
];

export async function GET() {
  try {
    await requireUser();
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SETTINGS_KEY))
      .limit(1);

    const saved = (row?.value ?? null) as AccountingDisplayColumn[] | null;
    return NextResponse.json({ columns: saved || DEFAULT_COLUMNS });
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

    await db
      .insert(appSettings)
      .values({ key: SETTINGS_KEY, value: columns as any })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: columns as any },
      });

    return NextResponse.json({ columns });
  } catch (err) {
    console.error("PUT /api/admin/accounting-display error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
