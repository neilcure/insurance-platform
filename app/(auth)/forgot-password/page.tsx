"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const ForgotSchema = z.object({
  email: z.string().email("Enter a valid email"),
});
type ForgotInput = z.infer<typeof ForgotSchema>;

export default function ForgotPasswordPage() {
  const [resetLink, setResetLink] = React.useState<string | null>(null);
  const form = useForm<ForgotInput>({
    resolver: zodResolver(ForgotSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  async function onSubmit(values: ForgotInput) {
    setResetLink(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      toast.success("If an account exists, a reset link was sent.");
      if (data.resetLink) setResetLink(data.resetLink);
    } catch (err: any) {
      toast.error(err?.message ?? "Request failed");
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>Forgot Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input placeholder="you@example.com" {...form.register("email")} />
          </div>
          <div className="flex justify-end">
            <Button onClick={form.handleSubmit(onSubmit)}>Send Reset Link</Button>
          </div>

          {resetLink ? (
            <div className="mt-4 rounded-md border p-4">
              <div className="mb-2 text-sm font-medium">Development reset link</div>
              <div className="flex gap-2">
                <Input value={resetLink} readOnly />
                <Button variant="secondary" onClick={() => navigator.clipboard.writeText(resetLink)}>
                  Copy
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}




















