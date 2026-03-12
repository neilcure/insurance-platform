import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import UploadDocumentTypesManager from "@/components/admin/documents/UploadDocumentTypesManager";

export default async function UploadDocumentsPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Upload Document Types
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Configure the types of documents that agents or clients need to upload for
          each policy. Admin uploads are auto-verified; agent/client uploads require
          admin verification.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Document Types</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadDocumentTypesManager />
        </CardContent>
      </Card>
    </main>
  );
}
