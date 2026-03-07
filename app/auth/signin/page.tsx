"use client";

import { getProviders, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";
import { Separator } from "@/components/ui/separator";
import { Chrome } from "lucide-react";

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md px-6 py-10">Loading...</main>
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
  const { status } = useSession();

  const [email, setEmail] = useState(emailFromLink ?? "agent@example.com");
  const [password, setPassword] = useState(emailFromLink ? "" : "demo1234");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [hasGoogle, setHasGoogle] = useState<boolean>(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Focus and select the email field on load so users can type immediately
  useEffect(() => {
    const el = emailRef.current;
    if (!el) return;
    // Defer to ensure it runs after paint
    const id = window.requestAnimationFrame(() => {
      el.focus();
      el.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Detect whether Google provider is configured server-side
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

  // If already authenticated, go to callbackUrl
  useEffect(() => {
    if (status === "authenticated") {
      router.push(callbackUrl);
      router.refresh();
    }
  }, [status, router, callbackUrl]);

  // Surface OAuth errors (e.g. AccessDenied when Google account isn't invited/active)
  useEffect(() => {
    if (!errorFromUrl) return;
    if (errorFromUrl === "AccessDenied") {
      setError("Google sign-in is only available for invited, active users. Please ask an admin to invite your email.");
      return;
    }
    setError(`Sign in error: ${errorFromUrl}`);
  }, [errorFromUrl]);

  function selectAll(ref: React.RefObject<HTMLInputElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setError("");
    try {
      // Redirect-based flow; NextAuth will send the user to Google
      await signIn("google", { callbackUrl });
    } catch {
      setError("Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
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
        setError(result.error === "CredentialsSignin" ? "Email 或密碼錯誤" : result.error);
        return;
      }

      router.push(result.url ?? callbackUrl);
      router.refresh();
    } catch (err) {
      setError("Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Login</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              ref={emailRef}
              onMouseEnter={() => selectAll(emailRef)}
              onFocus={() => selectAll(emailRef)}
              className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-500 outline-none ring-0 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-400"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              ref={passwordRef}
              onMouseEnter={() => selectAll(passwordRef)}
              onFocus={() => selectAll(passwordRef)}
              className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-500 outline-none ring-0 focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-400"
            />
          </div>
          <Button className="w-full" disabled={loading} onClick={handleSubmit}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          {hasGoogle ? (
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
          ) : (
            <p className="text-xs text-muted-foreground">
              Google login is not configured on this environment.
            </p>
          )}

          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}


