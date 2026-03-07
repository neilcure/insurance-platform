import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { ServerSuccessToast } from "@/components/ui/ServerSuccessToast";
import { ClearQueryParam } from "@/components/ui/ClearQueryParam";
import { serverFetch } from "@/lib/auth/server-fetch";
import { ClientPrefixDialog, FlowPrefixDialog } from "@/components/admin/ClientPrefixDialog";

type UserTypePrefixes = {
  admin: string;
  agent: string;
  accounting: string;
  internal_staff: string;
};

type FlowButtonConfig = { label: string; flow: string };

type ClientSettings = {
  companyPrefix: string;
  personalPrefix: string;
  userTypePrefixes: UserTypePrefixes;
  flowButtons: Record<string, FlowButtonConfig>;
  flowPrefixes: Record<string, string>;
};

type FlowOption = {
  id: number;
  label: string;
  value: string;
  meta?: { showInDashboard?: boolean; dashboardLabel?: string } | null;
};

async function loadSettings(): Promise<ClientSettings | null> {
  const res = await serverFetch("/api/admin/client-settings");
  if (!res.ok) return null;
  return (await res.json()) as ClientSettings;
}

async function loadFlows(): Promise<{ all: FlowOption[]; dashboard: FlowOption[] }> {
  const res = await serverFetch("/api/form-options?groupKey=flows");
  if (!res.ok) return { all: [], dashboard: [] };
  const data = (await res.json()) as FlowOption[];
  const all = Array.isArray(data) ? data : [];
  const dashboard = all.filter((f) => f.meta?.showInDashboard);
  return { all, dashboard };
}

export default async function ClientSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const [settingsRaw, { all: allFlows, dashboard: dashboardFlows }] = await Promise.all([loadSettings(), loadFlows()]);
  const settings = settingsRaw ?? {
    companyPrefix: "C",
    personalPrefix: "P",
    userTypePrefixes: { admin: "AD", agent: "AG", accounting: "AC", internal_staff: "IN" },
    flowButtons: {},
    flowPrefixes: {},
  };
  async function saveAction(formData: FormData) {
    "use server";
    await requireUser();
    const companyPrefix = String(formData.get("companyPrefix") ?? "").trim();
    const personalPrefix = String(formData.get("personalPrefix") ?? "").trim();
    const admin = String(formData.get("prefix_admin") ?? "").trim();
    const agent = String(formData.get("prefix_agent") ?? "").trim();
    const accounting = String(formData.get("prefix_accounting") ?? "").trim();
    const internal_staff = String(formData.get("prefix_internal_staff") ?? "").trim();
    const flowButtons: Record<string, { label: string; flow: string }> = {};
    const flowPrefixes: Record<string, string> = {};
    const dashboardLabels: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      const labelMatch = key.match(/^fb_label_(.+)$/);
      const flowMatch = key.match(/^fb_flow_(.+)$/);
      const prefixMatch = key.match(/^fp_(.+)$/);
      const dlMatch = key.match(/^dl_(\d+)$/);
      if (labelMatch) {
        const k = labelMatch[1];
        if (!flowButtons[k]) flowButtons[k] = { label: "", flow: "" };
        flowButtons[k].label = String(value).trim();
      }
      if (flowMatch) {
        const k = flowMatch[1];
        if (!flowButtons[k]) flowButtons[k] = { label: "", flow: "" };
        flowButtons[k].flow = String(value).trim();
      }
      if (prefixMatch) {
        const k = prefixMatch[1];
        const v = String(value).trim();
        if (v) flowPrefixes[k] = v;
      }
      if (dlMatch) {
        dashboardLabels[dlMatch[1]] = String(value).trim();
      }
    }
    if (!companyPrefix || !personalPrefix) {
      return;
    }
    const res = await serverFetch("/api/admin/client-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyPrefix,
        personalPrefix,
        userTypePrefixes: { admin, agent, accounting, internal_staff },
        flowButtons,
        flowPrefixes,
      }),
    });
    if (res.ok) {
      // Update each flow's dashboardLabel in formOptions (merge with existing meta)
      if (Object.keys(dashboardLabels).length > 0) {
        try {
          const flowRes = await serverFetch(`/api/form-options?groupKey=flows`);
          const flowRows = flowRes.ok
            ? ((await flowRes.json()) as Array<{ id: number; meta?: Record<string, unknown> | null }>)
            : [];
          for (const [idStr, label] of Object.entries(dashboardLabels)) {
            const id = Number(idStr);
            if (!Number.isFinite(id) || id <= 0) continue;
            const row = flowRows.find((r) => r.id === id);
            if (!row) continue;
            const mergedMeta = { ...(row.meta ?? {}), dashboardLabel: label || undefined };
            await serverFetch(`/api/admin/form-options/${id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ meta: mergedMeta }),
            });
          }
        } catch {
          // best-effort
        }
      }
      revalidatePath("/admin/client-settings");
      redirect("/admin/client-settings?saved=1");
    }
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
            <div>
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
            {(dashboardFlows.length > 0 || allFlows.length > 0) && (
              <div className="mt-8 border-t border-neutral-200 dark:border-neutral-800 pt-6">
                <h3 className="text-sm font-medium mb-4">Dashboard Buttons</h3>
                <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
                  Configure the button on each dashboard page. Set the label and which flow it opens.
                </p>
                <div className="grid grid-cols-[1fr_1fr_5rem] gap-4 mb-2">
                  <Label className="text-xs font-medium">Button Label</Label>
                  <Label className="text-xs font-medium">Assigned Flow</Label>
                  <Label className="text-xs font-medium">Prefix</Label>
                </div>
                <div className="space-y-4">
                  {dashboardFlows.map((f) => {
                    const cfg = settings.flowButtons[f.value];
                    const displayName = f.meta?.dashboardLabel || f.label;
                    const assignedFlow = cfg?.flow || f.value;
                    const isClientFlow = assignedFlow.toLowerCase().includes("client");
                    return (
                      <div key={f.value}>
                        <Input
                          name={`dl_${f.id}`}
                          defaultValue={displayName}
                          placeholder={f.label}
                          className="mb-1 h-7 border-dashed text-xs text-neutral-500 dark:text-neutral-400"
                        />
                        <div className="grid grid-cols-[1fr_1fr_5rem] gap-4">
                          <Input
                            name={`fb_label_${f.value}`}
                            defaultValue={cfg?.label ?? ""}
                            placeholder={`New ${displayName}`}
                          />
                          <select
                            name={`fb_flow_${f.value}`}
                            defaultValue={assignedFlow}
                            className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                          >
                            {allFlows.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          {isClientFlow ? (
                            <ClientPrefixDialog
                              companyPrefix={settings.companyPrefix}
                              personalPrefix={settings.personalPrefix}
                            />
                          ) : (
                            <FlowPrefixDialog
                              flowKey={f.value}
                              flowLabel={displayName}
                              defaultPrefix={settings.flowPrefixes[f.value] ?? ""}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex justify-end pt-4">
              <Button type="submit">
                <Save className="h-4 w-4 sm:hidden lg:inline" />
                <span className="hidden sm:inline">Save</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

