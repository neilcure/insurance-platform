import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DocumentTemplatesManager from "@/components/admin/documents/DocumentTemplatesManager";

export default async function DocumentTemplatesPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Document Templates
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Design document templates (quotations, invoices, certificates) that
          can be generated from policy data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentTemplatesManager />
        </CardContent>
      </Card>
    </main>
  );
}
