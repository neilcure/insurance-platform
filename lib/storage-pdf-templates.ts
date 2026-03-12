import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TEMPLATES_ROOT = path.join(process.cwd(), ".uploads", "pdf-templates");

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
  await fs.mkdir(TEMPLATES_ROOT, { recursive: true });
  const uuid = crypto.randomUUID();
  const ext = path.extname(fileName).toLowerCase();
  const base = sanitize(path.basename(fileName, ext));
  const storedName = `${uuid}-${base}${ext}`;
  await fs.writeFile(path.join(TEMPLATES_ROOT, storedName), buffer);
  return storedName;
}

export async function readPdfTemplate(storedName: string): Promise<Buffer> {
  return fs.readFile(path.join(TEMPLATES_ROOT, storedName));
}

export async function deletePdfTemplate(storedName: string): Promise<void> {
  try {
    await fs.unlink(path.join(TEMPLATES_ROOT, storedName));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
