import { Suspense } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { Separator } from "@/components/ui/separator";
import { SettingsBlock } from "@/components/ui/settings-block";
import FlowsManager from "@/components/admin/flows/FlowsManager";

export default async function PolicySettingsFlowsPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }
  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Policy Settings</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Manage working flows for policy creation.</p>
      </div>
      <Separator />
      <SettingsBlock title="Flows" description="Add flows and manage their steps.">
        <div className="w-full overflow-x-auto">
          <Suspense fallback={<div className="min-h-[200px] animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800" />}>
            <FlowsManager />
          </Suspense>
        </div>
      </SettingsBlock>
    </main>
  );
}






