"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, Mail } from "lucide-react";
import { useT } from "@/lib/i18n";

// The schema's `Enter a valid email` message is used as a `zod` error code
// pre-translation. The page renders it via `t("auth.forgot.invalidEmail", ...)`
// when displaying the message — see `displayedEmailError` below.
const ForgotSchema = z.object({
  email: z.string().email("Enter a valid email"),
});
type ForgotInput = z.infer<typeof ForgotSchema>;

export default function ForgotPasswordPage() {
  const t = useT();
  const [sent, setSent] = React.useState(false);
  const [devLink, setDevLink] = React.useState<string | null>(null);
  const form = useForm<ForgotInput>({
    resolver: zodResolver(ForgotSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  async function onSubmit(values: ForgotInput) {
    setDevLink(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      setSent(true);
      toast.success(t("auth.forgot.toastSuccess", "If an account exists, a reset link was sent."));
      if (data.resetLink) setDevLink(data.resetLink);
    } catch (err: any) {
      toast.error(err?.message ?? t("auth.forgot.toastError", "Request failed"));
    }
  }

  const isDev = typeof window !== "undefined" && window.location.hostname === "localhost";

  // Translate the zod email-format error message at render time so the
  // schema itself stays plain English (zod chokes on dynamic values when
  // building schemas inside a render closure).
  const emailError = form.formState.errors.email?.message;
  const displayedEmailError =
    emailError === "Enter a valid email"
      ? t("auth.forgot.invalidEmail", "Enter a valid email")
      : emailError;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900 dark:bg-neutral-100">
            <Mail className="h-6 w-6 text-white dark:text-neutral-900" />
          </div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("auth.forgot.title", "Reset your password")}</h1>
          <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            {sent
              ? t("auth.forgot.checkEmail", "Check your email for a reset link.")
              : t("auth.forgot.description", "Enter your email and we'll send you a link to reset your password.")}
          </p>
        </div>

        {!sent ? (
          <Card className="border-neutral-200 dark:border-neutral-800">
            <CardContent className="pt-6">
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">{t("auth.email", "Email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    {...form.register("email")}
                  />
                  {displayedEmailError ? (
                    <p className="text-xs text-red-600 dark:text-red-400">{displayedEmailError}</p>
                  ) : null}
                </div>
                <Button type="submit" className="w-full">
                  {t("auth.forgot.sendLink", "Send reset link")}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-neutral-200 dark:border-neutral-800">
            <CardContent className="pt-6 text-center">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {t("auth.forgot.sentMessage", "If an account with that email exists, you'll receive a password reset link shortly.")}
              </p>
              {isDev && devLink ? (
                <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-700 dark:bg-amber-950">
                  <div className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-300">{t("auth.forgot.devOnly", "Dev only - Reset link:")}</div>
                  <div className="flex gap-2">
                    <Input value={devLink} readOnly className="text-xs" />
                    <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(devLink)}>
                      {t("auth.forgot.copy", "Copy")}
                    </Button>
                  </div>
                </div>
              ) : null}
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setSent(false);
                  setDevLink(null);
                }}
              >
                {t("auth.forgot.tryAnother", "Try another email")}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="mt-4 text-center">
          <Link
            href="/auth/signin"
            className="inline-flex items-center gap-1 text-xs text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("auth.forgot.backToSignIn", "Back to sign in")}
          </Link>
        </div>
      </div>
    </main>
  );
}
