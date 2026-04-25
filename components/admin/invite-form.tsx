"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Loader2, Search, UserPlus } from "lucide-react";

type UserType = "admin" | "agent" | "accounting" | "internal_staff" | "direct_client";

type UnlinkedClient = {
  id: number | string;
  clientNumber: string;
  displayName: string;
  category: string;
  primaryId: string;
  source?: "table" | "flow";
};

export default function InviteForm({ allowedTypes = ["admin", "agent", "accounting", "internal_staff", "direct_client"] }: { allowedTypes?: UserType[] }) {
  const safeTypes = React.useMemo<UserType[]>(
    () => (Array.isArray(allowedTypes) && allowedTypes.length > 0 ? allowedTypes : ["accounting", "internal_staff"]),
    [allowedTypes]
  );
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [userType, setUserType] = React.useState<UserType>(safeTypes[0]!);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Client linking state
  const [unlinkedClients, setUnlinkedClients] = React.useState<UnlinkedClient[]>([]);
  const [clientsLoading, setClientsLoading] = React.useState(false);
  const [selectedClientId, setSelectedClientId] = React.useState<number | string | null>(null);
  const [clientSearch, setClientSearch] = React.useState("");

  const isClientType = userType === "direct_client";

  React.useEffect(() => {
    if (!safeTypes.includes(userType)) {
      setUserType(safeTypes[0]!);
    }
  }, [safeTypes, userType]);

  React.useEffect(() => {
    if (!isClientType) {
      setSelectedClientId(null);
      return;
    }
    let cancelled = false;
    async function loadClients() {
      setClientsLoading(true);
      try {
        const res = await fetch("/api/admin/unlinked-clients", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setUnlinkedClients(Array.isArray(data) ? data : []);
        }
      } catch {}
      if (!cancelled) setClientsLoading(false);
    }
    void loadClients();
    return () => { cancelled = true; };
  }, [isClientType]);

  const filteredClients = React.useMemo(() => {
    if (!clientSearch.trim()) return unlinkedClients;
    const q = clientSearch.trim().toLowerCase();
    return unlinkedClients.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.clientNumber.toLowerCase().includes(q) ||
        c.primaryId.toLowerCase().includes(q)
    );
  }, [unlinkedClients, clientSearch]);

  const selectedClient = unlinkedClients.find((c) => c.id === selectedClientId);

  // Auto-fill name from selected client record
  React.useEffect(() => {
    if (selectedClient) {
      setName(selectedClient.displayName);
    }
  }, [selectedClient]);

  async function submit() {
    if (isClientType && !selectedClientId) {
      toast.error("Please select a client record to link");
      return;
    }
    setSubmitting(true);
    setInviteLink(null);
    try {
      const payload: Record<string, unknown> = { email, name, userType };
      if (isClientType && selectedClientId) {
        const sel = unlinkedClients.find((c) => c.id === selectedClientId);
        if (sel?.source === "flow" && typeof sel.id === "string") {
          payload.flowCarId = Number(String(sel.id).replace("flow_", ""));
        } else {
          payload.clientId = selectedClientId;
        }
      }
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to create invite");
        setSubmitting(false);
        return;
      }
      if (data.inviteLink) {
        setInviteLink(data.inviteLink);
        toast.success("Invite created (development)");
      } else {
        toast.success("Invite created");
      }
      setEmail("");
      setName("");
      setSelectedClientId(null);
      setUserType(safeTypes[0]!);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create invite";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite User</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
        </div>
        <div className="grid gap-2">
          <Label>{isClientType && selectedClient ? (selectedClient.category === "company" ? "Company Name" : "Client Name") : "Name"}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isClientType ? "Auto-filled from client record" : "Full name"}
            readOnly={isClientType && !!selectedClient}
            className={isClientType && selectedClient ? "bg-neutral-100 dark:bg-neutral-800" : ""}
          />
        </div>
        <div className="grid gap-2">
          <Label>User Type</Label>
          <RadioGroup value={userType} onValueChange={(v: string) => setUserType(v as UserType)} className="flex flex-wrap gap-4">
            {safeTypes.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={t} id={`t-${t}`} />
                <span className="capitalize">
                  {t === "internal_staff" ? "Internal Staff" : t === "direct_client" ? "Direct Client" : t.replace("_", " ")}
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>

        {isClientType && (
          <div className="grid gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
            <Label>Link to Client Record</Label>
            {clientsLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading clients...
              </div>
            ) : unlinkedClients.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                No unlinked client records found. Create a client via the Clients flow first.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-neutral-400" />
                  <Input
                    className="pl-8"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Search by name, ID, or client number..."
                  />
                </div>
                <div className="max-h-40 overflow-y-auto rounded border border-neutral-200 dark:border-neutral-700">
                  {filteredClients.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-neutral-400">No matching clients</p>
                  ) : (
                    filteredClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedClientId(c.id)}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                          selectedClientId === c.id
                            ? "bg-blue-50 dark:bg-blue-900/30"
                            : "hover:bg-neutral-100 dark:hover:bg-neutral-700/50"
                        }`}
                      >
                        <span className="font-mono text-xs text-neutral-500">{c.clientNumber}</span>
                        <span className="font-medium">{c.displayName}</span>
                        <span className="ml-auto text-xs text-neutral-400">{c.primaryId}</span>
                      </button>
                    ))
                  )}
                </div>
                {selectedClient && (
                  <p className="text-sm text-green-600 dark:text-green-400">
                    Selected: <strong>{selectedClient.displayName}</strong> ({selectedClient.clientNumber})
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex justify-start sm:justify-end">
          <Button disabled={submitting || (isClientType && !selectedClientId)} onClick={submit} className="inline-flex items-center gap-2">
            <UserPlus className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">{submitting ? "Creating..." : "Create Invite"}</span>
          </Button>
        </div>
        {inviteLink ? (
          <div className="grid gap-2">
            <Label>Invite Link (development)</Label>
            <div className="flex flex-wrap gap-2">
              <Input value={inviteLink} readOnly className="min-w-0 flex-1" />
              <Button
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(inviteLink!)}
                className="inline-flex items-center gap-2 shrink-0"
                title="Copy invite link"
              >
                <Copy className="h-4 w-4 sm:hidden lg:inline" />
                <span className="hidden sm:inline">Copy</span>
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}


