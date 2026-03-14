"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const ResetSchema = z
  .object({
    password: z.string().min(10, "Password must be at least 10 characters"),
    confirm: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Passwords do not match" });

type ResetInput = z.infer<typeof ResetSchema>;

export default function ResetPasswordPage(props: { params: Promise<{ token: string }> }) {
  const { token } = React.use(props.params);
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm<ResetInput>({
    resolver: zodResolver(ResetSchema),
    defaultValues: { password: "", confirm: "" },
    mode: "onChange",
  });

  const passwordValue = form.watch("password");
  const charCount = passwordValue?.length ?? 0;

  async function onSubmit(values: ResetInput) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: values.password }),
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

  function onInvalid() {
    const errs = form.formState.errors;
    const first = errs.password?.message || errs.confirm?.message;
    if (first) toast.error(first);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4" autoComplete="off">
            <div className="grid gap-1.5">
              <Label htmlFor="password">New Password</Label>
              <PasswordInput
                id="password"
                autoComplete="off"
                placeholder="At least 10 characters"
                {...form.register("password")}
              />
              <div className="flex items-center justify-between">
                {form.formState.errors.password ? (
                  <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                ) : (
                  <span />
                )}
                <span className={`text-xs tabular-nums ${charCount >= 10 ? "text-green-500" : "text-muted-foreground"}`}>
                  {charCount}/10
                </span>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="confirm">Confirm Password</Label>
              <PasswordInput
                id="confirm"
                autoComplete="off"
                placeholder="Re-enter your password"
                {...form.register("confirm")}
              />
              {form.formState.errors.confirm && (
                <p className="text-sm text-destructive">{form.formState.errors.confirm.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}




















