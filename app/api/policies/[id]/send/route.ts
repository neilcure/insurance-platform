import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { cars } from "@/db/schema/insurance";
import { memberships } from "@/db/schema/core";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { sendEmail, getBaseUrlFromRequestUrl } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json();
    const email = String(body?.email ?? "").trim();
    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email address is required" },
        { status: 400 },
      );
    }

    const orgIds = await db
      .select({ orgId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, Number(user.id)));
    if (orgIds.length === 0) {
      return NextResponse.json({ error: "No organisation" }, { status: 403 });
    }

    const [policy] = await db
      .select({
        id: policies.id,
        policyNumber: policies.policyNumber,
        organisationId: policies.organisationId,
        createdAt: policies.createdAt,
      })
      .from(policies)
      .where(
        and(
          eq(policies.id, id),
          eq(
            policies.organisationId,
            orgIds[0].orgId,
          ),
        ),
      )
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const baseUrl = getBaseUrlFromRequestUrl(request.url);
    const car = await db
      .select({ extraAttributes: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, policy.id))
      .limit(1);
    const extra = (car[0]?.extraAttributes ?? {}) as Record<string, unknown>;
    const flowKey = String(extra.flowKey ?? "").trim();
    const policyUrl = flowKey
      ? `${baseUrl}/dashboard/flows/${encodeURIComponent(flowKey)}?policyId=${policy.id}`
      : `${baseUrl}/dashboard/policies?policyId=${policy.id}`;

    const createdDate = (() => {
      const d = new Date(policy.createdAt);
      return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    })();

    const result = await sendEmail({
      to: email,
      subject: `Policy ${policy.policyNumber} - Shared with you`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Policy Shared With You</h2>
          <p>A policy record has been shared with you by ${user.name || user.email}.</p>
          <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
            <tr>
              <td style="padding: 8px; border: 1px solid #e5e5e5; font-weight: 600;">Policy #</td>
              <td style="padding: 8px; border: 1px solid #e5e5e5; font-family: monospace;">${policy.policyNumber}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #e5e5e5; font-weight: 600;">Created</td>
              <td style="padding: 8px; border: 1px solid #e5e5e5;">${createdDate}</td>
            </tr>
          </table>
          <p>
            <a href="${policyUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">
              View Policy
            </a>
          </p>
          <p style="color: #888; font-size: 12px; margin-top: 24px;">
            This email was sent from the insurance platform.
          </p>
        </div>
      `,
      text: `Policy ${policy.policyNumber} has been shared with you by ${user.name || user.email}. View it at: ${policyUrl}`,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to send email" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
