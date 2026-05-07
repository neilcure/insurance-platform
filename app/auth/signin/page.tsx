"use client";

import { getProviders, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useSession } from "next-auth/react";
import { Separator } from "@/components/ui/separator";
import { Chrome, ShieldCheck } from "lucide-react";

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
          <div className="text-sm text-neutral-500">Loading...</div>
        </main>
      }
    >
      <SignInContent />
    </Suspense>
  );
}

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const emailFromLink = searchParams.get("email") ?? undefined;
  const errorFromUrl = searchParams.get("error") ?? "";
  const reasonFromUrl = searchParams.get("reason") ?? "";
  const { status } = useSession();

  const [email, setEmail] = useState(emailFromLink ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [hasGoogle, setHasGoogle] = useState<boolean>(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = emailRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => {
      el.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Defensive auto-fill defeat.
  //
  // The browser's password manager will happily autofill a previously
  // saved account into this form — most painfully right after an
  // idle-timeout sign-out, where the user typically wants to sign
  // back into the SAME account they were just kicked out of, but the
  // browser may pre-fill a DIFFERENT saved account (e.g. an admin
  // they signed in as days ago on the same machine). The user then
  // clicks "Sign in" without noticing the wrong email/password and
  // ends up logged in as the WRONG user.
  //
  // We defeat autofill in two layers:
  //
  //   1. The inputs themselves carry `autoComplete="off"` /
  //      "new-password" + `data-1p-ignore` / `data-lpignore` to ask
  //      browsers AND password managers (1Password, LastPass, etc.)
  //      to skip them — see the Input/PasswordInput rendering below.
  //
  //   2. Browsers (notably Chrome) routinely IGNORE autocomplete=off
  //      on known login fields. So we also force-clear any pre-filled
  //      values shortly after mount: anything the browser pasted in
  //      between mount and the first paint we wipe back to empty.
  //      The `?email=` invite-link case is preserved — we only clear
  //      when there's no explicit invite email in the URL.
  useEffect(() => {
    if (emailFromLink) return;
    const id = window.setTimeout(() => {
      const emailEl = emailRef.current;
      const pwEl = passwordRef.current;
      if (emailEl && emailEl.value && emailEl.value !== email) {
        emailEl.value = "";
        setEmail("");
      }
      if (pwEl && pwEl.value && pwEl.value !== password) {
        pwEl.value = "";
        setPassword("");
      }
    }, 100);
    return () => window.clearTimeout(id);
    // Run once on mount only — re-running on every keystroke would
    // wipe the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const providers = await getProviders();
        if (cancelled) return;
        setHasGoogle(Boolean(providers?.google));
      } catch {
        if (cancelled) return;
        setHasGoogle(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      router.push(callbackUrl);
      router.refresh();
    }
  }, [status, router, callbackUrl]);

  useEffect(() => {
    if (!errorFromUrl) return;
    if (errorFromUrl === "AccessDenied") {
      setError("Google sign-in is only available for invited, active users. Please ask an admin to invite your email.");
      return;
    }
    setError(`Sign in error: ${errorFromUrl}`);
  }, [errorFromUrl]);

  useEffect(() => {
    if (reasonFromUrl !== "idle") return;
    setError("You were signed out automatically due to inactivity. Please sign in again.");
  }, [reasonFromUrl]);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError("");
    try {
      await signIn("google", { callbackUrl });
    } catch {
      setError("Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (!result) {
        setError("No response from auth server.");
        return;
      }
      if (result.error) {
        setError(result.error === "CredentialsSignin" ? "Invalid email or password." : result.error);
        return;
      }

      router.push(result.url ?? callbackUrl);
      router.refresh();
    } catch {
      setError("Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900 dark:bg-neutral-100">
            <ShieldCheck className="h-6 w-6 text-white dark:text-neutral-900" />
          </div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Welcome back</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Sign in to your account to continue</p>
        </div>

        <Card className="border-neutral-200 dark:border-neutral-800">
          <CardContent className="pt-6">
            {/*
              autoComplete="off" on the form is the standard hint to
              browsers + password managers to skip autofill. See the
              long comment in the component above for why this is
              important on the sign-in page (preventing the wrong saved
              account from auto-logging in after an idle-timeout).
            */}
            <form
              onSubmit={handleSubmit}
              className="grid gap-4"
              autoComplete="off"
            >
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  // Defeat password-manager extensions that ignore
                  // autocomplete="off" but respect their own opt-out
                  // attributes (1Password, LastPass, Bitwarden).
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  // Random-ish name + readOnly-then-removed trick:
                  // Chrome ignores autocomplete=off on `name="email"`
                  // / `type="email"`, but is far less aggressive when
                  // the field name doesn't match a known credential
                  // pattern.
                  name="signin-identifier"
                  ref={emailRef}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
                  >
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  // "new-password" is the most reliable signal across
                  // Chrome / Firefox / Safari to NOT autofill a saved
                  // password into this field.
                  autoComplete="new-password"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  name="signin-secret"
                  ref={passwordRef}
                />
              </div>

              {error ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</p>
              ) : null}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            {hasGoogle ? (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={loading}
                  onClick={handleGoogleSignIn}
                >
                  <Chrome className="mr-2 h-4 w-4" />
                  Continue with Google
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
          Don&apos;t have an account? Contact your administrator.
        </p>
      </div>
    </main>
  );
}
