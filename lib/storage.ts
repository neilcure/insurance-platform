import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UPLOADS_ROOT = path.join(process.cwd(), ".uploads", "documents");

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);
}

export function validateFile(
  fileName: string,
  mimeType: string,
  size: number,
): { valid: true } | { valid: false; error: string } {
  const ext = path.extname(fileName).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type "${ext}" is not allowed. Accepted: ${[...ALLOWED_EXTENSIONS].join(", ")}` };
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { valid: false, error: `MIME type "${mimeType}" is not allowed.` };
  }

  if (size > MAX_FILE_SIZE) {
    const maxMB = Math.round(MAX_FILE_SIZE / 1024 / 1024);
    return { valid: false, error: `File size exceeds ${maxMB}MB limit.` };
  }

  return { valid: true };
}

export async function saveFile(
  policyId: number,
  fileName: string,
  buffer: Buffer,
): Promise<{ storedPath: string; sanitizedName: string }> {
  const dir = path.join(UPLOADS_ROOT, String(policyId));
  await fs.mkdir(dir, { recursive: true });

  const uuid = crypto.randomUUID();
  const ext = path.extname(fileName).toLowerCase();
  const sanitized = sanitizeFileName(path.basename(fileName, ext));
  const storedName = `${uuid}-${sanitized}${ext}`;
  const fullPath = path.join(dir, storedName);

  await fs.writeFile(fullPath, buffer);

  const storedPath = `${policyId}/${storedName}`;
  return { storedPath, sanitizedName: storedName };
}

export async function readFile(storedPath: string): Promise<Buffer> {
  const fullPath = path.join(UPLOADS_ROOT, storedPath);
  return fs.readFile(fullPath);
}

export async function deleteFile(storedPath: string): Promise<void> {
  const fullPath = path.join(UPLOADS_ROOT, storedPath);
  try {
    await fs.unlink(fullPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function deleteAllPolicyFiles(policyId: number): Promise<void> {
  const dir = path.join(UPLOADS_ROOT, String(policyId));
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
