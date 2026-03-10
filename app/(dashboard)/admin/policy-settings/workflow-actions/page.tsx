import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import WorkflowActionsManager from "@/components/admin/documents/WorkflowActionsManager";

export default async function WorkflowActionsPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Workflow Actions
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Configure actions that appear in the Actions tab of record drawers.
          You can add, edit, disable, or remove actions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowActionsManager />
        </CardContent>
      </Card>
    </main>
  );
}
