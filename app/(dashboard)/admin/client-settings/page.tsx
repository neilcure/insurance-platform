import { cookies } from "next/headers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";
import { ServerSuccessToast } from "@/components/ui/ServerSuccessToast";
import { ClearQueryParam } from "@/components/ui/ClearQueryParam";

type UserTypePrefixes = {
  admin: string;
  agent: string;
  accounting: string;
  internal_staff: string;
};

async function loadSettings(): Promise<{ companyPrefix: string; personalPrefix: string; userTypePrefixes: UserTypePrefixes } | null> {
  const cookieStore = (await (cookies() as unknown as Promise<ReturnType<typeof cookies>>)) as any;
  const cookieHeader = cookieStore
    .getAll()
    .map((c: { name: string; value: string }) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  const base = process.env.NEXTAUTH_URL ?? "";
  const res = await fetch(`${base}/api/admin/client-settings`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as { companyPrefix: string; personalPrefix: string; userTypePrefixes: UserTypePrefixes };
}

export default async function ClientSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const settings =
    (await loadSettings()) ?? {
      companyPrefix: "C",
      personalPrefix: "P",
      userTypePrefixes: { admin: "AD", agent: "AG", accounting: "AC", internal_staff: "IN" },
    };
  async function saveAction(formData: FormData) {
    "use server";
    // Ensure user is logged in; role-based enforcement is handled by the API route
    await requireUser();
    const companyPrefix = String(formData.get("companyPrefix") ?? "").trim();
    const personalPrefix = String(formData.get("personalPrefix") ?? "").trim();
    const admin = String(formData.get("prefix_admin") ?? "").trim();
    const agent = String(formData.get("prefix_agent") ?? "").trim();
    const accounting = String(formData.get("prefix_accounting") ?? "").trim();
    const internal_staff = String(formData.get("prefix_internal_staff") ?? "").trim();
    if (!companyPrefix || !personalPrefix) {
      return;
    }
    // Call the API so keys are saved with the same per-organisation suffix logic
    const cookieStore = (await (cookies() as unknown as Promise<ReturnType<typeof cookies>>)) as any;
    const cookieHeader = cookieStore
      .getAll()
      .map((c: { name: string; value: string }) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join("; ");
    const base = process.env.NEXTAUTH_URL ?? "";
    const res = await fetch(`${base}/api/admin/client-settings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      cache: "no-store",
      body: JSON.stringify({
        companyPrefix,
        personalPrefix,
        userTypePrefixes: { admin, agent, accounting, internal_staff },
      }),
    });
    if (res.ok) {
      revalidatePath("/admin/client-settings");
      redirect("/admin/client-settings?saved=1");
    }
    // If it failed, just revalidate and return (page will stay and not show "saved")
    revalidatePath("/admin/client-settings");
  }
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-3xl">
      <ClearQueryParam name="saved" />
      {sp?.saved ? <ServerSuccessToast message="Settings saved" /> : null}
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Client Number Settings</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Prefixes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form action={saveAction}>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Company Prefix</Label>
                <Input id="companyPrefix" name="companyPrefix" defaultValue={settings.companyPrefix} required />
              </div>
              <div className="space-y-1">
                <Label>Personal Prefix</Label>
                <Input id="personalPrefix" name="personalPrefix" defaultValue={settings.personalPrefix} required />
              </div>
            </div>
            <div className="mt-6">
              <h3 className="text-sm font-medium mb-2">User Type Prefixes</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Admin</Label>
                  <Input id="prefix_admin" name="prefix_admin" defaultValue={settings.userTypePrefixes.admin} required />
                </div>
                <div className="space-y-1">
                  <Label>Agent</Label>
                  <Input id="prefix_agent" name="prefix_agent" defaultValue={settings.userTypePrefixes.agent} required />
                </div>
                <div className="space-y-1">
                  <Label>Accounting</Label>
                  <Input
                    id="prefix_accounting"
                    name="prefix_accounting"
                    defaultValue={settings.userTypePrefixes.accounting}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Internal Staff</Label>
                  <Input
                    id="prefix_internal_staff"
                    name="prefix_internal_staff"
                    defaultValue={settings.userTypePrefixes.internal_staff}
                    required
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

