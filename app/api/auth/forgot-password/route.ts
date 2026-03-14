import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users, passwordResets } from "@/db/schema/core";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { sendEmail, getBaseUrlFromRequestUrl } from "@/lib/email";

// Simple in-memory rate limiter by email hash; resets when server reloads
const rateBucket = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT = 5; // 5 requests per minute per email

const ForgotBody = z.object({
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = ForgotBody.safeParse(json);
    if (!parsed.success) {
      // Return ok:true to avoid user enumeration
      return NextResponse.json({ ok: true });
    }
    const email = parsed.data.email.trim().toLowerCase();

    // Rate-limit per email
    const key = crypto.createHash("sha256").update(email).digest("hex");
    const now = Date.now();
    const bucket = rateBucket.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateBucket.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    } else {
      if (bucket.count >= RATE_LIMIT) {
        // Still hide existence; but slow down
        await new Promise((r) => setTimeout(r, 500));
        return NextResponse.json({ ok: true });
      }
      bucket.count += 1;
    }

    // Find active user
    const [u] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.isActive, true)))
      .limit(1);

    if (u) {
      // Create reset token
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.insert(passwordResets).values({
        userId: u.id,
        tokenHash,
        expiresAt: expiresAt.toISOString() as unknown as any,
      });

      const resetPath = `/reset-password/${token}`;
      const isDev = process.env.NODE_ENV !== "production";

      if (isDev) {
        return NextResponse.json({ ok: true, resetLink: resetPath });
      }

      const baseUrl = getBaseUrlFromRequestUrl(request.url);
      const resetLink = `${baseUrl}${resetPath}`;

      await sendEmail({
        to: u.email,
        subject: "Reset your password",
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="margin-bottom: 16px;">Reset your password</h2>
            <p>We received a request to reset the password for your account.</p>
            <p>Click the button below to set a new password. This link expires in 1 hour.</p>
            <a href="${resetLink}" style="display: inline-block; background: #171717; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">Reset Password</a>
            <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
        text: `Reset your password: ${resetLink}`,
      });
    }

    // Always return ok
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    // Still avoid enumeration
    return NextResponse.json({ ok: true });
  }
}




















