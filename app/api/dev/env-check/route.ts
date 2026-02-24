import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }
  const hasBrevoApiKey = !!process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.length > 5;
  const hasBrevoSender = !!process.env.BREVO_SENDER && process.env.BREVO_SENDER.includes("@");
  return NextResponse.json(
    {
      hasBrevoApiKey,
      hasBrevoSender,
      brevoSender: process.env.BREVO_SENDER ?? null,
      appUrl: process.env.APP_URL ?? null,
    },
    { status: 200 }
  );
}

















