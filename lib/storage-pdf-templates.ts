import crypto from "node:crypto";
import path from "node:path";
import { db } from "@/db/client";
import { pdfTemplateFiles } from "@/db/schema/pdf_template_files";
import { eq } from "drizzle-orm";

function sanitize(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);
}

export async function savePdfTemplate(
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  const uuid = crypto.randomUUID();
  const ext = path.extname(fileName).toLowerCase();
  const base = sanitize(path.basename(fileName, ext));
  const storedName = `${uuid}-${base}${ext}`;

  await db.insert(pdfTemplateFiles).values({
    storedName,
    content: buffer,
  });

  return storedName;
}

export async function readPdfTemplate(storedName: string): Promise<Buffer> {
  const [row] = await db
    .select({ content: pdfTemplateFiles.content })
    .from(pdfTemplateFiles)
    .where(eq(pdfTemplateFiles.storedName, storedName))
    .limit(1);

  if (!row) {
    throw new Error(`PDF template file not found: ${storedName}`);
  }

  return row.content;
}

export async function deletePdfTemplate(storedName: string): Promise<void> {
  await db
    .delete(pdfTemplateFiles)
    .where(eq(pdfTemplateFiles.storedName, storedName));
}
