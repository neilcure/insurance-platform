import { requireUser } from "@/lib/auth/require-user";
import { Separator } from "@/components/ui/separator";
import { SettingsBlock } from "@/components/ui/settings-block";
import StepsManager from "@/components/admin/flows/StepsManager";

export default async function PolicySettingsFlowStepsPage(props: { params: Promise<{ flow: string }> }) {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }
  const { flow } = await props.params;
  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Policy Settings</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Configure steps for flow: {flow}</p>
      </div>
      <Separator />
      <SettingsBlock title="Steps" description="Add, edit or remove steps.">
        <div className="w-full overflow-x-auto">
          <StepsManager flow={flow} />
        </div>
      </SettingsBlock>
    </main>
  );
}






