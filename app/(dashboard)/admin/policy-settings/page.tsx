import { requireUser } from "@/lib/auth/require-user";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tStatic } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export default async function PolicySettingsPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }
  const locale = await getLocale();
  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          {tStatic("admin.policySettings.title", locale, "Policy Settings")}
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {tStatic(
            "admin.policySettings.description",
            locale,
            "Configure policy-related options.",
          )}
        </p>
      </div>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle>
            {tStatic("admin.policySettings.availableSettings", locale, "Available Settings")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Link
            href="/admin/policy-settings/policy/category"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {tStatic("sidebar.accountingRules", locale, "Accounting Rules")}
          </Link>
          <Link
            href="/admin/policy-settings/vehicle/category"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {tStatic("admin.policySettings.vehicleCategory", locale, "Vehicle Category")}
          </Link>
          <Link
            href="/admin/policy-settings/vehicle/fields"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {tStatic("admin.policySettings.vehicleFields", locale, "Vehicle Fields")}
          </Link>
          <Link
            href="/admin/policy-settings/document-templates"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {tStatic("sidebar.documentTemplates", locale, "Document Templates")}
          </Link>
          <Link
            href="/admin/policy-settings/workflow-actions"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {tStatic("sidebar.workflowActions", locale, "Workflow Actions")}
          </Link>
          <Link
            href="/admin/policy-settings/upload-documents"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {tStatic(
              "admin.policySettings.uploadDocumentTypes",
              locale,
              "Upload Document Types",
            )}
          </Link>
          <Link
            href="/admin/policy-settings/backend-documents"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {tStatic("sidebar.backendDocuments", locale, "Backend Documents")}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}


