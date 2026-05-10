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
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoVariant, setLogoVariant] = useState<"light" | "dark">("light");
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

  // Defensive auto-fill defeat — ONLY on the idle-timeout sign-in.
  //
  // Why scoped to `?reason=idle`
  // ----------------------------
  // Browser / password-manager autofill is a feature most users
  // legitimately want on a normal sign-in (single-user laptops,
  // remembered passwords, etc.). Disabling it everywhere is annoying.
  //
  // BUT after an idle-timeout sign-out the situation is different:
  // - The user already had a session a moment ago, so they're trying
  //   to sign back into the SAME account they were just kicked out of.
  // - On shared / multi-account machines, the browser may pre-fill a
  //   DIFFERENT saved account (e.g. an admin they signed in as days
  //   ago) into this form. A quick click on "Sign in" submits those
  //   wrong credentials and authenticates them as the wrong user.
  //
  // So we only force-clear pre-filled values when arriving via the
  // idle-timeout redirect (`/auth/signin?reason=idle`). Normal first-
  // time sign-ins keep the convenient autofill behaviour.
  //
  // The `?email=` invite-link case is also preserved — we only clear
  // when there's no explicit invite email in the URL.
  const isIdleRedirect = reasonFromUrl === "idle";
  useEffect(() => {
    if (!isIdleRedirect) return;
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
    // Detect the actual theme applied by next-themes (class strategy: `.dark` on <html>).
    const prefersDark = document.documentElement.classList.contains("dark");
    setLogoVariant(prefersDark ? "dark" : "light");
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
          {logoFailed ? (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900 dark:bg-neutral-100">
              <ShieldCheck className="h-6 w-6 text-white dark:text-neutral-900" />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/admin/assets/logo?variant=${logoVariant}`}
              alt="Logo"
              className="h-24 w-auto max-w-[360px] object-contain object-center"
              onError={() => {
                // Try the other variant before giving up
                if (logoVariant === "light") {
                  setLogoVariant("dark");
                } else {
                  setLogoFailed(true);
                }
              }}
            />
          )}
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Welcome back</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Sign in to your account to continue</p>
        </div>

        <Card className="border-neutral-200 dark:border-neutral-800">
          <CardContent className="pt-6">
            {/*
              On normal sign-ins we let the browser / password manager
              autofill as usual (convenient single-user UX).
              On the post-timeout sign-in (`?reason=idle`) we switch the
              attributes to actively SUPPRESS autofill — see the long
              comment on `isIdleRedirect` above for why.
            */}
            <form
              onSubmit={handleSubmit}
              className="grid gap-4"
              autoComplete={isIdleRedirect ? "off" : "on"}
            >
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  // Normal sign-in: keep `autoComplete="email"` so saved
                  // accounts populate. Post-timeout: `off` + a non-
                  // standard `name` (Chrome ignores `off` on a field
                  // named "email" / `type="email"`).
                  autoComplete={isIdleRedirect ? "off" : "email"}
                  name={isIdleRedirect ? "signin-identifier" : "email"}
                  // Password-manager-extension opt-outs (1Password,
                  // LastPass, Bitwarden). These attributes are no-ops
                  // on a normal sign-in (no extension reads them) so
                  // it's safe to leave them off in that branch and
                  // ONLY apply during the idle-suppression mode.
                  {...(isIdleRedirect && {
                    "data-1p-ignore": "true",
                    "data-lpignore": "true",
                    "data-bwignore": "true",
                  })}
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
                  // Normal sign-in: `current-password` so the password
                  // manager fills in the saved password. Post-timeout:
                  // `new-password` (the most reliable browser signal
                  // to NOT autofill a saved password).
                  autoComplete={isIdleRedirect ? "new-password" : "current-password"}
                  name={isIdleRedirect ? "signin-secret" : "password"}
                  {...(isIdleRedirect && {
                    "data-1p-ignore": "true",
                    "data-lpignore": "true",
                    "data-bwignore": "true",
                  })}
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
