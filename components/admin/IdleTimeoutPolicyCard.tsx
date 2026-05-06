"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_IDLE_TIMEOUT_POLICY,
  EDITABLE_ROLES,
  ROLE_LABELS,
  type IdleRoleConfig,
  type IdleTimeoutPolicy,
  type UserTypeKey,
  DEFAULT_ROLE_CONFIG,
} from "@/lib/idle-timeout/policy";

type Draft = {
  enabled: boolean;
  /** UI uses minutes for idle and seconds for warn — easier to read. */
  perRole: Record<UserTypeKey, { idleMinutes: number; warnSeconds: number }>;
};

function policyToDraft(p: IdleTimeoutPolicy): Draft {
  const perRole = {} as Draft["perRole"];
  for (const role of EDITABLE_ROLES) {
    const cfg: IdleRoleConfig = p.perRole[role] ?? DEFAULT_ROLE_CONFIG;
    perRole[role] = {
      idleMinutes: Math.max(1, Math.round(cfg.idleSeconds / 60)),
      warnSeconds: Math.max(10, Math.round(cfg.warnSeconds)),
    };
  }
  return { enabled: !!p.enabled, perRole };
}

function draftToPolicy(d: Draft): IdleTimeoutPolicy {
  const perRole: IdleTimeoutPolicy["perRole"] = {};
  for (const role of EDITABLE_ROLES) {
    const r = d.perRole[role];
    perRole[role] = {
      idleSeconds: Math.max(60, r.idleMinutes * 60),
      warnSeconds: Math.max(10, r.warnSeconds),
    };
  }
  return { enabled: d.enabled, perRole };
}

export function IdleTimeoutPolicyCard() {
  const [draft, setDraft] = useState<Draft>(() =>
    policyToDraft(DEFAULT_IDLE_TIMEOUT_POLICY),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/idle-timeout-policy")
      .then((r) => r.json())
      .then((p: IdleTimeoutPolicy) => setDraft(policyToDraft(p)))
      .catch(() => setDraft(policyToDraft(DEFAULT_IDLE_TIMEOUT_POLICY)))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/idle-timeout-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draftToPolicy(draft)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Failed to save");
        return;
      }
      toast.success("Idle-timeout policy saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Idle Timeout</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Idle Timeout</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-md border px-4 py-3">
          <div>
            <p className="text-sm font-medium">Enable auto sign-out on inactivity</p>
            <p className="text-xs text-muted-foreground">
              When on, signed-in users see an &ldquo;Are you still there?&rdquo;
              prompt after the configured idle period and are signed
              out automatically if they don&apos;t respond.
            </p>
          </div>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
          />
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-medium">Per-role thresholds</Label>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Idle before warning (minutes)</th>
                  <th className="px-3 py-2">Warning countdown (seconds)</th>
                </tr>
              </thead>
              <tbody>
                {EDITABLE_ROLES.map((role) => {
                  const r = draft.perRole[role];
                  return (
                    <tr key={role} className="border-t">
                      <td className="px-3 py-2 font-medium">{ROLE_LABELS[role]}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={1}
                          max={720}
                          value={r.idleMinutes}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              perRole: {
                                ...d.perRole,
                                [role]: {
                                  ...d.perRole[role],
                                  idleMinutes: Math.max(1, Number(e.target.value) || 1),
                                },
                              },
                            }))
                          }
                          disabled={!draft.enabled}
                          className="w-28"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={10}
                          max={300}
                          value={r.warnSeconds}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              perRole: {
                                ...d.perRole,
                                [role]: {
                                  ...d.perRole[role],
                                  warnSeconds: Math.max(10, Number(e.target.value) || 10),
                                },
                              },
                            }))
                          }
                          disabled={!draft.enabled}
                          className="w-28"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Idle time must be at least 1 minute (max 12 hours). Warning
            countdown must be 10–300 seconds. Tighter limits are
            recommended for client-facing roles, since they often use
            shared / public devices.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving} title="Save Idle-Timeout Policy">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin sm:hidden lg:inline" />
            ) : (
              <Save className="h-4 w-4 sm:hidden lg:inline" />
            )}
            <span className="hidden sm:inline">Save</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
