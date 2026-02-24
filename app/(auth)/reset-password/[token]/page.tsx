"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const ResetSchema = z
  .object({
    password: z.string().min(10, "Password must be at least 10 characters"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Passwords do not match" });

type ResetInput = z.infer<typeof ResetSchema>;

export default function ResetPasswordPage(props: { params: { token: string } }) {
  const token = props.params.token;
  const router = useRouter();
  const form = useForm<ResetInput>({
    resolver: zodResolver(ResetSchema),
    defaultValues: { password: "", confirm: "" },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  async function onSubmit(values: ResetInput) {
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
      router.push("/login");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to reset password");
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>New Password (min 10 chars)</Label>
            <Input type="password" autoComplete="new-password" {...form.register("password")} />
          </div>
          <div className="grid gap-2">
            <Label>Confirm Password</Label>
            <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
          </div>
          <div className="flex justify-end">
            <Button onClick={form.handleSubmit(onSubmit)}>Update Password</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}




















