import { getServerSession } from "next-auth";
import type { DefaultSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

export type SessionUser = DefaultSession["user"] & {
  id: string;
  userType: "admin" | "agent" | "internal_staff" | "accounting" | "direct_client" | "service_provider";
};

export async function requireUser(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  const u = session.user as any;
  return { ...session.user, id: String(u.id), userType: u.userType } as SessionUser;
}


