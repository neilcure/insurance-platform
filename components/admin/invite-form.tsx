"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Loader2, Search, UserPlus, X } from "lucide-react";
import type { UserType } from "@/lib/user-types";
import { useUserTypes } from "@/hooks/use-user-types";

type CreationMode = "invite" | "account_only";
type AgentAccountType = "personal" | "company";

type UnlinkedClient = {
  id: number | string;
  clientNumber: string;
  displayName: string;
  category: string;
  primaryId: string;
  source?: "table" | "flow";
};

export default function InviteForm({ allowedTypes }: { allowedTypes?: UserType[] }) {
  const { options: configuredTypes, getLabel: getUserTypeLabel } = useUserTypes();
  const safeTypes = React.useMemo<UserType[]>(() => {
    const fromConfig = configuredTypes.map((t) => t.value as UserType);
    if (Array.isArray(allowedTypes) && allowedTypes.length > 0) {
      const allow = new Set(allowedTypes);
      const filtered = fromConfig.filter((v) => allow.has(v));
      if (filtered.length > 0) return filtered;
      return allowedTypes;
    }
    return fromConfig;
  }, [allowedTypes, configuredTypes]);
  const [email, setEmail] = React.useState("");
  const [mobile, setMobile] = React.useState("");
  const [name, setName] = React.useState("");
  const [userType, setUserType] = React.useState<UserType>(safeTypes[0]!);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [creationMode, setCreationMode] = React.useState<CreationMode>("account_only");
  const [agentAccountType, setAgentAccountType] = React.useState<AgentAccountType>("personal");
  const [agentCompanyName, setAgentCompanyName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [primaryId, setPrimaryId] = React.useState("");

  // Client linking state
  const [unlinkedClients, setUnlinkedClients] = React.useState<UnlinkedClient[]>([]);
  const [clientsLoading, setClientsLoading] = React.useState(false);
  const [selectedClientId, setSelectedClientId] = React.useState<number | string | null>(null);
  const [clientSearch, setClientSearch] = React.useState("");

  const isClientType = userType === "direct_client";
  const isAgentType = userType === "agent";

  React.useEffect(() => {
    if (!safeTypes.includes(userType)) {
      setUserType(safeTypes[0]!);
    }
  }, [safeTypes, userType]);

  React.useEffect(() => {
    if (isClientType && creationMode !== "invite") {
      setCreationMode("invite");
    }
  }, [isClientType, creationMode]);

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

  function buildDisplayName() {
    return [lastName.trim(), firstName.trim()].filter(Boolean).join(" ").trim();
  }

  async function submit() {
    if (isClientType && !selectedClientId) {
      toast.error("Please select a client record to link");
      return;
    }
    const resolvedName = isClientType ? name.trim() : buildDisplayName();
    setSubmitting(true);
    setInviteLink(null);
    try {
      const payload: Record<string, unknown> = {
        email,
        mobile,
        name: resolvedName || undefined,
        userType,
      };
      if (!isClientType) {
        payload.creationMode = creationMode;
      }
      if (isAgentType) {
        payload.agentProfile = {
          accountType: agentAccountType,
          companyName: agentAccountType === "company" ? agentCompanyName : undefined,
          primaryId: primaryId || undefined,
        };
      } else if (!isClientType && primaryId.trim()) {
        payload.userPrimaryId = primaryId.trim();
      }
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
      } else if (data.creationMode === "account_only") {
        toast.success("Account created without invite");
      } else {
        toast.success("Invite created");
      }
      setEmail("");
      setMobile("");
      setName("");
      setAgentAccountType("personal");
      setAgentCompanyName("");
      setLastName("");
      setFirstName("");
      setPrimaryId("");
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
          <Label>User Type</Label>
          <RadioGroup value={userType} onValueChange={(v: string) => setUserType(v as UserType)} className="flex flex-wrap gap-4">
            {safeTypes.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={t} id={`t-${t}`} />
                <span>{getUserTypeLabel(t)}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
        {isAgentType && (
          <>
            <div className="grid gap-2">
              <Label>Agent Account Type</Label>
              <RadioGroup
                value={agentAccountType}
                onValueChange={(v: string) => setAgentAccountType(v as AgentAccountType)}
                className="flex flex-wrap gap-4"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="personal" id="agent-type-personal" />
                  <span>Personal</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="company" id="agent-type-company" />
                  <span>Company</span>
                </label>
              </RadioGroup>
            </div>
            {agentAccountType === "company" ? (
              <div className="grid gap-2">
                <Label>Company Name</Label>
                <Input
                  value={agentCompanyName}
                  onChange={(e) => setAgentCompanyName(e.target.value)}
                  placeholder="Company legal name"
                />
              </div>
            ) : null}
          </>
        )}
        {/* Last name / First name for all non-direct-client types */}
        {!isClientType ? (
          <div className="grid gap-2">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <Label className="mb-0">Name</Label>
              {isAgentType && agentAccountType === "company" ? (
                <span className="text-[11px] font-normal text-neutral-500 dark:text-neutral-400">
                  Contact person who will use this login
                </span>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="last-name" className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
                  Last name
                </Label>
                <Input
                  id="last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  autoComplete="family-name"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="first-name" className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
                  First name
                </Label>
                <Input
                  id="first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label>{selectedClient ? (selectedClient.category === "company" ? "Company Name" : "Client Name") : "Name"}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-filled from client record"
              readOnly={!!selectedClient}
              className={selectedClient ? "bg-neutral-100 dark:bg-neutral-800" : ""}
            />
          </div>
        )}
        {/* ID Number for all non-direct-client, non-agent types (agent uses its own block above) */}
        {!isClientType && !isAgentType ? (
          <div className="grid gap-2">
            <Label>ID Number</Label>
            <Input
              value={primaryId}
              onChange={(e) => setPrimaryId(e.target.value)}
              placeholder="HKID or personal ID"
            />
          </div>
        ) : null}
        {/* Agent ID block (label changes with account type) */}
        {isAgentType ? (
          <div className="grid gap-2">
            <Label>{agentAccountType === "company" ? "BR / CI Number" : "ID Number"}</Label>
            <Input
              value={primaryId}
              onChange={(e) => setPrimaryId(e.target.value)}
              placeholder={agentAccountType === "company" ? "Business registration or CI number" : "HKID or personal ID"}
            />
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label>Mobile</Label>
          <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="mobile number" />
        </div>
        <div className="grid gap-2">
          <Label>
            Email{!isClientType && creationMode === "account_only" ? <span className="ml-1 text-xs font-normal text-neutral-500 dark:text-neutral-400">(optional)</span> : null}
          </Label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={!isClientType && creationMode === "account_only" ? "Leave blank to skip — admin can set it later" : "user@example.com"}
          />
          {!isClientType && creationMode === "account_only" ? (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Required only when sending an invite. Skipping it now creates the account without a login email; you can add one later via Edit.
            </p>
          ) : null}
        </div>
        {!isClientType && (
          <div className="grid gap-2">
            <Label>Creation Mode</Label>
            <RadioGroup
              value={creationMode}
              onValueChange={(v: string) => setCreationMode(v as CreationMode)}
              className="flex flex-wrap gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="account_only" id="creation-account-only" />
                <span>Create Account Only</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="invite" id="creation-invite" />
                <span>Create + Invite Now</span>
              </label>
            </RadioGroup>
          </div>
        )}

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
                  <div className="flex items-center justify-between gap-2 rounded-md bg-green-50 px-3 py-1.5 dark:bg-green-900/20">
                    <p className="text-sm text-green-700 dark:text-green-400">
                      Selected: <strong>{selectedClient.displayName}</strong> ({selectedClient.clientNumber})
                    </p>
                    <button
                      type="button"
                      onClick={() => { setSelectedClientId(null); setName(""); }}
                      className="shrink-0 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                      title="Deselect"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex justify-start sm:justify-end">
          <Button
            disabled={submitting || (isClientType && !selectedClientId)}
            onClick={submit}
            className="inline-flex items-center gap-2"
          >
            <UserPlus className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">
              {submitting ? "Creating..." : !isClientType && creationMode === "account_only" ? "Create Account" : "Create Invite"}
            </span>
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


