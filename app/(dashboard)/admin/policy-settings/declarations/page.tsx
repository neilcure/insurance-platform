import { requireUser } from "@/lib/auth/require-user";
import { Separator } from "@/components/ui/separator";
import { SettingsBlock } from "@/components/ui/settings-block";
import DeclarationsManager from "@/components/admin/declarations/DeclarationsManager";

export default async function PolicySettingsDeclarationsPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }
  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Policy Settings</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Manage policy-related options.</p>
      </div>
      <Separator />
      <SettingsBlock title="Declarations" description="Manage declaration questions used in the policy process.">
        <div className="w-full overflow-x-auto">
          <DeclarationsManager />
        </div>
      </SettingsBlock>
    </main>
  );
}


