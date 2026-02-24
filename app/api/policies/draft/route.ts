import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyDrafts } from "@/db/schema/insurance";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const { wizardState, currentStep } = body || {};
    const [row] = await db
      .insert(policyDrafts)
      .values({
        userId: Number((session.user as any).id),
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






















