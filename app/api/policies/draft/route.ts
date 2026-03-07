import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyDrafts } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const { wizardState, currentStep } = body || {};
    const [row] = await db
      .insert(policyDrafts)
      .values({
        userId: Number(user.id),
        wizardState: wizardState ?? {},
        currentStep: currentStep ?? 1,
      })
      .returning();
    return NextResponse.json({ draftId: row.id }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}






















