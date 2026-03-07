/* eslint-disable @next/next/no-img-element */
"use client";

import * as React from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type DemoCreds =
  | {
      email: string;
      password: string;
      role: string;
    }
  | null;

export default function HomeActions({
  isLoggedIn,
  role,
}: {
  isLoggedIn: boolean;
  role?: string;
}) {
  const [loading, setLoading] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [creds, setCreds] = React.useState<DemoCreds>(null);

  const seed = async () => {
    try {
      setLoading(true);
      setCreds(null);
      const res = await fetch("/api/dev/seed", { method: "POST" });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Seed failed");
      }
      const data = (await res.json()) as DemoCreds;
      setCreds(data);
      toast.success("Demo data ready");
    } catch (err: any) {
      toast.error(err?.message ?? "Seed failed");
    } finally {
      setLoading(false);
    }
  };

  if (isLoggedIn) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 pb-20 mt-6">
        <div className="flex items-center gap-2 mt-2 py-2">
          <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }))}>
            Go to Dashboard
          </Link>
          {role === "admin" ? (
            <Link href="/admin/policy-settings" className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>
              Go to Admin Settings
            </Link>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                setSigningOut(true);
                await signOut({ callbackUrl: "/" });
              } finally {
                setSigningOut(false);
              }
            }}
            disabled={signingOut}
            aria-busy={signingOut}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 pb-20">
      <div className="flex gap-2 mt-4 py-2">
        <Link href="/auth/signin" className={cn(buttonVariants({ size: "sm" }))}>
          Log in
        </Link>
        <Button size="sm" variant="secondary" onClick={seed} disabled={loading} aria-busy={loading}>
          {loading ? "Seeding..." : "Seed demo data"}
        </Button>
      </div>
      {creds ? (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Demo credentials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-neutral-600 dark:text-neutral-400">
              Use these to sign in via Credentials on the login page.
            </div>
            <Separator />
            <div className="grid gap-2 text-sm">
              <div>
                <span className="font-medium">Email: </span>
                <span className="font-mono">{creds.email}</span>
              </div>
              <div>
                <span className="font-medium">Password: </span>
                <span className="font-mono">{creds.password}</span>
              </div>
              <div>
                <span className="font-medium">Role: </span>
                <Badge>{creds.role}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}





