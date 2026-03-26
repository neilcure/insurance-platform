import { requireUser } from "@/lib/auth/require-user";
import { redirect } from "next/navigation";
import { SettingsBlock } from "@/components/ui/settings-block";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";

export default async function ActivityLogPage() {
  const me = await requireUser();
  if (me.userType !== "admin" && me.userType !== "internal_staff") redirect("/dashboard");

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Activity Log</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Track actions taken by clients, agents, and other users on their accounts.
        </p>
      </div>

      <SettingsBlock title="Recent Activity" description="Profile updates, login events, and other account actions.">
        <AuditLogPanel />
      </SettingsBlock>
    </main>
  );
}
