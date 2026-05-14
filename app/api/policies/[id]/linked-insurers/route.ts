import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { resolveLinkedInsurerPolicyIds } from "@/lib/policies/resolve-linked-insurer-policy-ids";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const insurerPolicyIds = await resolveLinkedInsurerPolicyIds(policyId);
    return NextResponse.json({ insurerPolicyIds });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
