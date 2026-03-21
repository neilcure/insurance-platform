import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { savePdfTemplate } from "@/lib/storage-pdf-templates";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  _ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file || !file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "An image file (PNG or JPG) is required" },
      { status: 400 },
    );
  }

  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Image must be under 2 MB" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storedName = await savePdfTemplate(file.name, buffer);

  return NextResponse.json({ storedName });
}
