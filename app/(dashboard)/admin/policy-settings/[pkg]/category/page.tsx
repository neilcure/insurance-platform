import { requireUser } from "@/lib/auth/require-user";
import { Separator } from "@/components/ui/separator";
import { SettingsBlock } from "@/components/ui/settings-block";
import GenericCategoryManager from "@/components/admin/generic/GenericCategoryManager";

export default async function PolicySettingsGenericCategoryPage(props: { params: Promise<{ pkg: string }> }) {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }
  const { pkg } = await props.params;
  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Policy Settings</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Manage categories for package: {pkg}</p>
      </div>
      <Separator />
      <SettingsBlock title="Categories" description="Manage selectable categories for this package.">
        <div className="w-full overflow-x-auto">
          <GenericCategoryManager groupKey={`${pkg}_category`} />
        </div>
      </SettingsBlock>
    </main>
  );
}



