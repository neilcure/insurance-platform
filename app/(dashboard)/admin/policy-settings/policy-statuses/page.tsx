import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PolicyStatusesManager from "@/components/admin/documents/PolicyStatusesManager";

export default async function PolicyStatusesPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Policy Statuses
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Configure the statuses available in the Status tab. You can restrict statuses to specific flows
          and assign colors. If no statuses are configured, default statuses will be used.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Statuses</CardTitle>
        </CardHeader>
        <CardContent>
          <PolicyStatusesManager />
        </CardContent>
      </Card>
    </main>
  );
}
