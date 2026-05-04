import { getServerSession } from "next-auth";
import type { DefaultSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export type SessionUser = DefaultSession["user"] & {
  id: string;
  userType: "admin" | "agent" | "internal_staff" | "accounting" | "direct_client" | "service_provider";
  /**
   * The user's currently selected organisation, derived at sign-in
   * from their first membership. May be undefined for `admin` /
   * `internal_staff` users who don't belong to any specific org —
   * in that case downstream code MUST resolve the org from the
   * request payload via `resolveActiveOrgId`.
   */
  activeOrganisationId?: number;
};

export async function requireUser(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  const u = session.user as any;
  const activeOrganisationId = Number(u.activeOrganisationId);
  return {
    ...session.user,
    id: String(u.id),
    userType: u.userType,
    ...(Number.isFinite(activeOrganisationId) && activeOrganisationId > 0
      ? { activeOrganisationId }
      : {}),
  } as SessionUser;
}


