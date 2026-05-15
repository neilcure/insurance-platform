import path from "node:path";
import { promises as fs } from "node:fs";

export const ANNOUNCEMENT_MEDIA_ROOT = path.join(process.cwd(), ".uploads", "announcement-media");

export function mediaDirForOrg(orgId: number): string {
  return path.join(ANNOUNCEMENT_MEDIA_ROOT, String(orgId));
}

export function mediaFilePath(orgId: number, storedName: string): string {
  const safe = path.basename(storedName);
  if (!safe || safe !== storedName) {
    throw new Error("Invalid stored file name");
  }
  return path.join(mediaDirForOrg(orgId), safe);
}

export async function ensureOrgMediaDir(orgId: number): Promise<void> {
  await fs.mkdir(mediaDirForOrg(orgId), { recursive: true });
}

export async function removeMediaFile(orgId: number, storedName: string | null | undefined): Promise<void> {
  if (!storedName) return;
  try {
    await fs.unlink(mediaFilePath(orgId, storedName));
  } catch {
    /* ignore missing file */
  }
}
