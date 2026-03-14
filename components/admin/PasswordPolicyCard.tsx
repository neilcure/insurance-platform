"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PasswordPolicy } from "@/lib/password-policy";
import { DEFAULT_PASSWORD_POLICY } from "@/lib/password-policy";

export function PasswordPolicyCard() {
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/password-policy")
      .then((r) => r.json())
      .then((data: PasswordPolicy) => setPolicy(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (policy.minLength < 6) {
      toast.error("Minimum length must be at least 6");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/password-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as { error?: string }).error ?? "Failed to save");
        return;
      }
      toast.success("Password policy saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Password Policy</CardTitle></CardHeader>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password Policy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-1.5">
          <Label htmlFor="minLength">Minimum Password Length</Label>
          <Input
            id="minLength"
            type="number"
            min={6}
            max={128}
            value={policy.minLength}
            onChange={(e) => setPolicy((p) => ({ ...p, minLength: Number(e.target.value) || 6 }))}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">Minimum 6, applied to password reset and new passwords</p>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-medium">Requirements</Label>

          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Require uppercase letter</p>
              <p className="text-xs text-muted-foreground">At least one A-Z</p>
            </div>
            <Switch
              checked={policy.requireUppercase}
              onCheckedChange={(v) => setPolicy((p) => ({ ...p, requireUppercase: v }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Require lowercase letter</p>
              <p className="text-xs text-muted-foreground">At least one a-z</p>
            </div>
            <Switch
              checked={policy.requireLowercase}
              onCheckedChange={(v) => setPolicy((p) => ({ ...p, requireLowercase: v }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Require number</p>
              <p className="text-xs text-muted-foreground">At least one 0-9</p>
            </div>
            <Switch
              checked={policy.requireNumber}
              onCheckedChange={(v) => setPolicy((p) => ({ ...p, requireNumber: v }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Require special character</p>
              <p className="text-xs text-muted-foreground">At least one !@#$%^&* etc.</p>
            </div>
            <Switch
              checked={policy.requireSpecial}
              onCheckedChange={(v) => setPolicy((p) => ({ ...p, requireSpecial: v }))}
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Policy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
