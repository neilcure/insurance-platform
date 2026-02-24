import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users, passwordResets } from "@/db/schema/core";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";

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

      const resetLink = `/reset-password/${token}`;
      const isDev = process.env.NODE_ENV !== "production";
      if (isDev) {
        return NextResponse.json({ ok: true, resetLink });
      }
    }

    // Always return ok
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    // Still avoid enumeration
    return NextResponse.json({ ok: true });
  }
}




















