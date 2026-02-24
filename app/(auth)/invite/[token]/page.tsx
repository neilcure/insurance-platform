"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token ?? "") as string;
  const router = useRouter();
  const [email, setEmail] = React.useState<string>("");
  const [password, setPassword] = React.useState<string>("");
  const [confirm, setConfirm] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/auth/invite/info?token=${encodeURIComponent(token)}`, {
          method: "GET",
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data?.error ?? "Invalid or expired invite");
          return;
        }
        setEmail(data.email);
      } catch {
        /* ignore */
      }
    })();
    return () => controller.abort();
  }, [token]);

  async function onSubmit() {
    if (password.length < 10) {
      toast.error("Password must be at least 10 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to accept invite");
        setSubmitting(false);
        return;
      }
      toast.success("Password set. You can now log in.");
      router.push(`/auth/signin?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to accept invite");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>Accept Invite</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={email} readOnly />
          </div>
          <div className="grid gap-2">
            <Label>Password (min 10 chars)</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" />
          </div>
          <div className="grid gap-2">
            <Label>Confirm Password</Label>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" autoComplete="new-password" />
          </div>
          <div className="flex justify-end">
            <Button disabled={submitting} onClick={onSubmit}>
              {submitting ? "Submitting..." : "Set Password"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}





