import { NextResponse } from "next/server";
import { getDueReminders, sendReminderEmail, checkAndAutoComplete } from "@/lib/reminder-sender";
import { getBaseUrlFromRequestUrl } from "@/lib/email";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      const token = authHeader?.replace("Bearer ", "").trim();
      if (token !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const baseUrl = getBaseUrlFromRequestUrl(request.url);
    const dueSchedules = await getDueReminders();

    let sent = 0;
    let failed = 0;
    let autoCompleted = 0;

    for (const schedule of dueSchedules) {
      await checkAndAutoComplete(schedule.policyId, schedule.documentTypeKey);

      const recheck = await getDueReminders();
      const stillDue = recheck.find((r) => r.id === schedule.id);
      if (!stillDue) {
        autoCompleted++;
        continue;
      }

      const result = await sendReminderEmail(schedule.id, baseUrl);
      if (result.ok) {
        sent++;
      } else {
        failed++;
        console.error(`Reminder ${schedule.id} failed:`, result.error);
      }
    }

    return NextResponse.json({
      ok: true,
      processed: dueSchedules.length,
      sent,
      failed,
      autoCompleted,
    });
  } catch (err) {
    console.error("Cron send-reminders error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
