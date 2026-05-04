"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  type PasswordPolicy,
  DEFAULT_PASSWORD_POLICY,
  validatePassword,
  policyDescription,
} from "@/lib/password-policy";

export default function ResetPasswordPage(props: { params: Promise<{ token: string }> }) {
  const { token } = React.use(props.params);
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [policy, setPolicy] = React.useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
  const [policyLoaded, setPolicyLoaded] = React.useState(false);

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/admin/password-policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Partial<PasswordPolicy> | null) => {
        // Defensive merge: if the API returns a partial / malformed payload,
        // fall back field-by-field to DEFAULT_PASSWORD_POLICY so we never
        // render "Min undefined characters" / "At least undefined characters".
        if (data && typeof data === "object") {
          setPolicy((prev) => ({
            minLength:
              typeof data.minLength === "number" && data.minLength > 0
                ? data.minLength
                : prev.minLength,
            requireUppercase:
              typeof data.requireUppercase === "boolean"
                ? data.requireUppercase
                : prev.requireUppercase,
            requireLowercase:
              typeof data.requireLowercase === "boolean"
                ? data.requireLowercase
                : prev.requireLowercase,
            requireNumber:
              typeof data.requireNumber === "boolean"
                ? data.requireNumber
                : prev.requireNumber,
            requireSpecial:
              typeof data.requireSpecial === "boolean"
                ? data.requireSpecial
                : prev.requireSpecial,
          }));
        }
      })
      .catch(() => {})
      .finally(() => setPolicyLoaded(true));
  }, []);

  const policyErrors = validatePassword(password, policy);
  const mismatch = confirm.length > 0 && password !== confirm;
  const isValid = policyErrors.length === 0 && password === confirm && confirm.length > 0;

  const rules = React.useMemo(() => {
    const list: { label: string; met: boolean }[] = [
      { label: `At least ${policy.minLength} characters`, met: password.length >= policy.minLength },
    ];
    if (policy.requireUppercase) list.push({ label: "Uppercase letter (A-Z)", met: /[A-Z]/.test(password) });
    if (policy.requireLowercase) list.push({ label: "Lowercase letter (a-z)", met: /[a-z]/.test(password) });
    if (policy.requireNumber) list.push({ label: "Number (0-9)", met: /\d/.test(password) });
    if (policy.requireSpecial) list.push({ label: "Special character (!@#...)", met: /[^A-Za-z0-9]/.test(password) });
    return list;
  }, [password, policy]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) {
      const msg = policyErrors[0] || (mismatch ? "Passwords do not match" : "Please fill in all fields");
      toast.error(msg);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to reset password");
        return;
      }
      toast.success("Password updated. You can now log in.");
      router.push("/auth/signin");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reset password";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!policyLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
          <p className="text-sm text-muted-foreground">{policyDescription(policy)}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            {/*
              Hidden dummy username field: prevents browser password managers
              (Chrome/Edge/Safari ignore autocomplete="off" on password inputs)
              from auto-filling the LAST signed-in account's saved password
              into this reset form. This field is non-focusable and never
              submitted server-side — it only acts as an autofill decoy.
            */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value=""
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="password">New Password</Label>
              <PasswordInput
                id="password"
                name="new-password"
                autoComplete="new-password"
                placeholder={`At least ${policy.minLength} characters`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (!touched) setTouched(true);
                }}
              />
              {touched && password.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {rules.map((r) => (
                    <li key={r.label} className="flex items-center gap-2 text-xs">
                      {r.met ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <X className="h-3 w-3 text-destructive" />
                      )}
                      <span className={r.met ? "text-green-500" : "text-muted-foreground"}>{r.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="confirm">Confirm Password</Label>
              <PasswordInput
                id="confirm"
                name="confirm-new-password"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && (
                <p className="text-sm text-destructive">Passwords do not match</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={submitting || !isValid}>
              {submitting ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}




















