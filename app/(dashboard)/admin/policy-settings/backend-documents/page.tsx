import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import UploadDocumentTypesManager from "@/components/admin/documents/UploadDocumentTypesManager";

export default async function BackofficeDocumentsPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Backend Documents
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Configure the types of documents the admin uploads to provide to the
          agent or client (e.g. signed policy documents, certificates). Clients
          and agents can view and download these files but cannot upload them.
          Reminders do not apply.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Document Types</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadDocumentTypesManager uploadSource="admin" />
        </CardContent>
      </Card>
    </main>
  );
}
