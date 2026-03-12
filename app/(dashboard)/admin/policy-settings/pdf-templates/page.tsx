import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PdfTemplateManager from "@/components/admin/pdf-templates/PdfTemplateManager";

export default async function PdfTemplatesPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          PDF Mail Merge Templates
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Upload PDF templates and map snapshot fields to positions on the PDF.
          Generate filled documents from any policy.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <PdfTemplateManager />
        </CardContent>
      </Card>
    </main>
  );
}
