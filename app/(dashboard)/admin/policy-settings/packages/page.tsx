import { requireUser } from "@/lib/auth/require-user";
import { Separator } from "@/components/ui/separator";
import { SettingsBlock } from "@/components/ui/settings-block";
import PackagesManager from "@/components/admin/packages/PackagesManager";

export default async function PolicySettingsPackagesPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }
  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Policy Settings</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Manage dynamic packages. Each package provides Categories and Fields.</p>
      </div>
      <Separator />
      <SettingsBlock title="Packages" description="Add or remove packages.">
        <div className="w-full overflow-x-auto">
          <PackagesManager />
        </div>
      </SettingsBlock>
    </main>
  );
}







