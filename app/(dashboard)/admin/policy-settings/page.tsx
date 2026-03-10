import { requireUser } from "@/lib/auth/require-user";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PolicySettingsPage() {
  const me = await requireUser();
  if (me.userType !== "admin") {
    throw new Error("Forbidden");
  }
  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Policy Settings</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Configure policy-related options.</p>
      </div>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle>Available Settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Link
            href="/admin/policy-settings/vehicle/category"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            Vehicle Category
          </Link>
          <Link
            href="/admin/policy-settings/vehicle/fields"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            Vehicle Fields
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}


