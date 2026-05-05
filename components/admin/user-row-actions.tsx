"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import ReissueInviteButton from "@/components/admin/reissue-invite-button";
import GenerateSetupLinkButton from "@/components/admin/generate-setup-link-button";
import { confirmDialog, promptDialog } from "@/components/ui/global-dialogs";
import { useRouter } from "next/navigation";
import { KeyRound, Link2, Loader2, Power, Search, Trash2, X } from "lucide-react";

type UserType = "admin" | "agent" | "direct_client" | "service_provider" | "internal_staff" | "accounting";
type UnlinkedClient = { id: number | string; clientNumber: string; displayName: string; category: string; primaryId: string; source?: "table" | "flow" };

export function UserRowActions({
  userId,
  userType,
  isActive,
  canAssignAdmin = true,
  linkedClientName,
}: {
  userId: number;
  userType: UserType;
  isActive: boolean;
  canAssignAdmin?: boolean;
  linkedClientName?: string | null;
}) {
  const router = useRouter();
  const [type, setType] = React.useState<UserType>(userType);
  const [active, setActive] = React.useState<boolean>(isActive);
  const [loading, setLoading] = React.useState<boolean>(false);

  // Client linking state
  const [showLinkPanel, setShowLinkPanel] = React.useState(false);
  const [unlinkedClients, setUnlinkedClients] = React.useState<UnlinkedClient[]>([]);
  const [clientsLoading, setClientsLoading] = React.useState(false);
  const [clientSearch, setClientSearch] = React.useState("");

  async function update(values: Partial<{ userType: UserType; isActive: boolean }>) {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Update failed");
      if (typeof data.userType === "string") setType(data.userType);
      if (typeof data.isActive === "boolean") setActive(data.isActive);
      toast.success("Updated");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Update failed");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    const newPassword = await promptDialog({
      title: "Reset password",
      description: "Enter a new password for this user.",
      placeholder: "New password",
      confirmLabel: "Reset",
    });
    if (!newPassword) return;
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Reset failed");
      toast.success("Password has been reset");
    } catch (err: any) {
      toast.error(err?.message ?? "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  async function del() {
    const ok = await confirmDialog({
      title: "Delete this user?",
      description: "This action cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      toast.success("User deleted");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  async function openLinkPanel() {
    setShowLinkPanel(true);
    setClientsLoading(true);
    try {
      const res = await fetch("/api/admin/unlinked-clients", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setUnlinkedClients(Array.isArray(data) ? data : []);
      }
    } catch {}
    setClientsLoading(false);
  }

  async function linkClient(clientId: number | string) {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${userId}/link-client`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Link failed");
      toast.success("Client linked");
      setShowLinkPanel(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Link failed");
    } finally {
      setLoading(false);
    }
  }

  const filteredClients = React.useMemo(() => {
    if (!clientSearch.trim()) return unlinkedClients;
    const q = clientSearch.trim().toLowerCase();
    return unlinkedClients.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.clientNumber.toLowerCase().includes(q) || c.primaryId.toLowerCase().includes(q)
    );
  }, [unlinkedClients, clientSearch]);

  const allowedRoles = canAssignAdmin
    ? ["admin", "agent", "accounting", "internal_staff", "direct_client"]
    : ["accounting", "internal_staff"];
  const isStaffRole = type === "agent" || type === "accounting" || type === "internal_staff";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-start gap-2 flex-wrap sm:flex-nowrap">
        <select
          className="min-w-[140px] rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          value={type}
          onChange={(e) => update({ userType: e.target.value as UserType })}
          disabled={loading}
        >
          {allowedRoles.map((t) => (
            <option key={t} value={t}>
              {t === "internal_staff" ? "internal staff" : t === "direct_client" ? "direct client" : t.replace("_", " ")}
            </option>
          ))}
          {type === "service_provider" ? (
            <option value="service_provider" disabled>service_provider (deprecated)</option>
          ) : null}
          {(type as any) === "insurer_staff" ? (
            <option value="insurer_staff" disabled>insurer_staff (renamed)</option>
          ) : null}
          {!canAssignAdmin && (type === "admin" || type === "agent") ? (
            <option value={type} disabled>{type} (restricted)</option>
          ) : null}
        </select>
        <Button
          size="sm"
          variant={active ? "secondary" : "default"}
          onClick={() => update({ isActive: !active })}
          disabled={loading}
          className="inline-flex items-center gap-2 whitespace-nowrap"
        >
          <Power className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">{active ? "Deactivate" : "Activate"}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="inline-flex items-center gap-2 whitespace-nowrap"
          onClick={resetPassword}
          disabled={loading}
        >
          <KeyRound className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">Reset PW</span>
        </Button>
        {!active && isStaffRole ? <GenerateSetupLinkButton userId={userId} /> : null}
        {!active ? <ReissueInviteButton userId={userId} /> : null}
        <Button
          size="sm"
          variant="outline"
          className="inline-flex items-center gap-2 border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 whitespace-nowrap"
          onClick={del}
          disabled={loading}
        >
          <Trash2 className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">Delete</span>
        </Button>
      </div>

      {/* Client link info / button */}
      {type === "direct_client" && (
        <div className="flex items-center gap-2 text-xs">
          {linkedClientName ? (
            <span className="rounded bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Linked: {linkedClientName}
            </span>
          ) : (
            <Button size="sm" variant="outline" className="h-6 gap-1 text-xs px-2" onClick={openLinkPanel} disabled={loading} title="Link Client">
              <Link2 className="h-3 w-3 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Link Client</span>
            </Button>
          )}
        </div>
      )}

      {/* Link client panel */}
      {showLinkPanel && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">Select client to link</span>
            <button onClick={() => setShowLinkPanel(false)} className="text-neutral-400 hover:text-neutral-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {clientsLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-neutral-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading...
            </div>
          ) : unlinkedClients.length === 0 ? (
            <p className="text-xs text-neutral-500">No unlinked client records</p>
          ) : (
            <>
              <div className="relative mb-1">
                <Search className="absolute left-2 top-1.5 h-3 w-3 text-neutral-400" />
                <Input
                  className="h-6 pl-6 text-xs"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search..."
                />
              </div>
              <div className="max-h-32 overflow-y-auto">
                {filteredClients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => linkClient(c.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700/50"
                  >
                    <span className="font-mono text-neutral-500">{c.clientNumber}</span>
                    <span>{c.displayName}</span>
                    <span className="ml-auto text-neutral-400">{c.primaryId}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


