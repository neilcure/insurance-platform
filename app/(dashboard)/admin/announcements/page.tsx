import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import AnnouncementsAdminClient from "@/components/admin/AnnouncementsAdminClient";
import { authOptions } from "@/lib/auth/options";

export default async function AdminAnnouncementsPage() {
  const session = await getServerSession(authOptions);
  const ut = ((session?.user as { userType?: string } | undefined)?.userType ?? "") as string;
  if (!session?.user || (ut !== "admin" && ut !== "internal_staff")) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <AnnouncementsAdminClient />
    </main>
  );
}
