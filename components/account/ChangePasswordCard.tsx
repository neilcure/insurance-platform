"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  type PasswordPolicy,
  DEFAULT_PASSWORD_POLICY,
  validatePassword,
} from "@/lib/password-policy";

export function ChangePasswordCard() {
  const [submitting, setSubmitting] = React.useState(false);
  const [policy, setPolicy] = React.useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  React.useEffect(() => {
    fetch("/api/admin/password-policy")
      .then((r) => r.json())
      .then((data: PasswordPolicy) => setPolicy(data))
      .catch(() => {});
  }, []);

  const policyErrors = validatePassword(newPassword, policy);
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const isValid =
    currentPassword.length > 0 &&
    policyErrors.length === 0 &&
    newPassword === confirmPassword &&
    confirmPassword.length > 0;

  const rules = React.useMemo(() => {
    const list: { label: string; met: boolean }[] = [
      { label: `At least ${policy.minLength} characters`, met: newPassword.length >= policy.minLength },
    ];
    if (policy.requireUppercase) list.push({ label: "Uppercase letter (A-Z)", met: /[A-Z]/.test(newPassword) });
    if (policy.requireLowercase) list.push({ label: "Lowercase letter (a-z)", met: /[a-z]/.test(newPassword) });
    if (policy.requireNumber) list.push({ label: "Number (0-9)", met: /\d/.test(newPassword) });
    if (policy.requireSpecial) list.push({ label: "Special character (!@#...)", met: /[^A-Za-z0-9]/.test(newPassword) });
    return list;
  }, [newPassword, policy]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to change password");
        return;
      }
      toast.success("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to change password";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="current_password">Current Password</Label>
            <PasswordInput
              id="current_password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              autoComplete="current-password"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new_password">New Password</Label>
            <PasswordInput
              id="new_password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirm_password">Confirm New Password</Label>
            <PasswordInput
              id="confirm_password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
            {mismatch && (
              <p className="text-sm text-red-600 dark:text-red-400">Passwords do not match</p>
            )}
          </div>

          {newPassword.length > 0 && (
            <ul className="space-y-1 text-sm">
              {rules.map((r) => (
                <li key={r.label} className="flex items-center gap-2">
                  {r.met ? (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <X className="h-4 w-4 text-red-600 dark:text-red-400" />
                  )}
                  <span
                    className={
                      r.met
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {r.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={!isValid || submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Change Password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
