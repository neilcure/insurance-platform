"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, UserPlus } from "lucide-react";

type UserType = "admin" | "agent" | "accounting" | "internal_staff";

export default function InviteForm({ allowedTypes = ["admin", "agent", "accounting", "internal_staff"] }: { allowedTypes?: UserType[] }) {
  const safeTypes = React.useMemo<UserType[]>(
    () => (Array.isArray(allowedTypes) && allowedTypes.length > 0 ? allowedTypes : ["accounting", "internal_staff"]),
    [allowedTypes]
  );
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [userType, setUserType] = React.useState<UserType>(safeTypes[0]!);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    // Ensure current selection is always within allowedTypes
    if (!safeTypes.includes(userType)) {
      setUserType(safeTypes[0]!);
    }
  }, [safeTypes, userType]);

  async function submit() {
    setSubmitting(true);
    setInviteLink(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, userType }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to create invite");
        setSubmitting(false);
        return;
      }
      if (data.inviteLink) {
        setInviteLink(data.inviteLink);
        toast.success("Invite created (development)");
      } else {
        toast.success("Invite created");
      }
      setEmail("");
      setName("");
      setUserType(safeTypes[0]!);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create invite";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite User</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
        </div>
        <div className="grid gap-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div className="grid gap-2">
          <Label>User Type</Label>
          <RadioGroup value={userType} onValueChange={(v: string) => setUserType(v as UserType)} className="flex flex-wrap gap-4">
            {safeTypes.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={t} id={`t-${t}`} />
                <span className="capitalize">
                  {t === "internal_staff" ? "internal staff" : t.replace("_", " ")}
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <div className="flex justify-start sm:justify-end">
          <Button disabled={submitting} onClick={submit} className="inline-flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">{submitting ? "Creating..." : "Create Invite"}</span>
          </Button>
        </div>
        {inviteLink ? (
          <div className="grid gap-2">
            <Label>Invite Link (development)</Label>
            <div className="flex gap-2">
              <Input value={inviteLink} readOnly />
              <Button variant="secondary" onClick={() => navigator.clipboard.writeText(inviteLink!)} className="inline-flex items-center gap-2">
                <Copy className="h-4 w-4" />
                <span className="hidden sm:inline">Copy</span>
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}


