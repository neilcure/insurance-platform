"use client";

/**
 * `<EditUserDialog>` — single dialog used by every page that needs to edit
 * an admin/agent/accounting/internal_staff user's profile.
 *
 * Two modes:
 *   - `mode="edit"` (default): saves edits via PATCH /api/admin/users/[id].
 *   - `mode="invite"`: same form, but on confirm it (1) saves any field
 *     changes via PATCH, then (2) issues a fresh invite via
 *     POST /api/admin/users/[id]/invites and copies the link to the clipboard.
 *
 * The dialog is purely controlled — caller manages `open` and decides what
 * to do `onSaved` (e.g. refresh the row) and `onInviteSent`.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { isPlaceholderEmail } from "@/lib/auth/placeholder-email";

export type EditableUser = {
  id: number;
  email: string;
  mobile?: string | null;
  name?: string | null;
  userType: "admin" | "agent" | "accounting" | "internal_staff" | string;
  accountType?: "personal" | "company" | null;
  companyName?: string | null;
  primaryId?: string | null;
};

export type EditUserDialogMode = "edit" | "invite";

export type EditUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: EditableUser | null;
  /** "edit" (default) — just save. "invite" — save (if changed) then send invite. */
  mode?: EditUserDialogMode;
  /** When mode="invite", controls the title wording. */
  inviteVerb?: "send" | "reissue";
  onSaved?: (updated: EditableUser) => void;
  onInviteSent?: (updated: EditableUser, inviteLink?: string) => void;
};

export function EditUserDialog({
  open,
  onOpenChange,
  user,
  mode = "edit",
  inviteVerb = "send",
  onSaved,
  onInviteSent,
}: EditUserDialogProps) {
  const [email, setEmail] = React.useState("");
  const [mobile, setMobile] = React.useState("");
  const [name, setName] = React.useState("");
  const [accountType, setAccountType] = React.useState<"personal" | "company">("personal");
  const [companyName, setCompanyName] = React.useState("");
  const [primaryId, setPrimaryId] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const isAgent = user?.userType === "agent";
  const isInviteMode = mode === "invite";
  const titleText = isInviteMode
    ? inviteVerb === "reissue"
      ? "Re-Issue Login Invite"
      : "Send Login Invite"
    : "Edit User";
  const descText = isInviteMode
    ? "Verify the email below — the invite link will be sent to it. You can correct any field here before sending."
    : "Update the login email, contact details, or agent profile fields.";
  const confirmLabel = isInviteMode
    ? saving ? "Working..." : "Save & Send Invite"
    : saving ? "Saving..." : "Save Changes";

  const hadPlaceholderEmail = isPlaceholderEmail(user?.email);

  React.useEffect(() => {
    if (!open || !user) return;
    setEmail(isPlaceholderEmail(user.email) ? "" : (user.email ?? ""));
    setMobile(user.mobile ?? "");
    setName(user.name ?? "");
    setAccountType(user.accountType === "company" ? "company" : "personal");
    setCompanyName(user.companyName ?? "");
    setPrimaryId(user.primaryId ?? "");
    setSaving(false);
  }, [open, user]);

  function buildPayload(): Record<string, unknown> {
    if (!user) return {};
    const trimmedEmail = email.trim().toLowerCase();
    const payload: Record<string, unknown> = {};
    if (trimmedEmail !== (user.email ?? "").toLowerCase()) payload.email = trimmedEmail;
    if (mobile.trim() !== (user.mobile ?? "")) payload.mobile = mobile.trim() ? mobile.trim() : null;
    if (name.trim() !== (user.name ?? "")) payload.name = name.trim() ? name.trim() : null;

    if (isAgent) {
      const profileMeta: Record<string, unknown> = {};
      if (accountType !== (user.accountType ?? "personal")) profileMeta.accountType = accountType;
      const newCompanyName = accountType === "company" ? companyName.trim() : "";
      if (newCompanyName !== (user.companyName ?? "")) {
        profileMeta.companyName = newCompanyName ? newCompanyName : null;
      }
      const newPrimaryId = primaryId.trim();
      if (newPrimaryId !== (user.primaryId ?? "")) {
        profileMeta.primaryId = newPrimaryId ? newPrimaryId : null;
      }
      if (Object.keys(profileMeta).length > 0) payload.profileMeta = profileMeta;
    }
    return payload;
  }

  function buildUpdatedUser(payload: Record<string, unknown>, data: Record<string, unknown> | null): EditableUser {
    const fallbackUser = user!;
    const trimmedEmail = email.trim().toLowerCase();
    const meta = (data?.profileMeta ?? {}) as Record<string, unknown>;
    return {
      id: fallbackUser.id,
      email: typeof data?.email === "string" ? data.email : trimmedEmail || fallbackUser.email,
      mobile:
        typeof data?.mobile === "string"
          ? data.mobile
          : payload.mobile === undefined
            ? fallbackUser.mobile ?? null
            : (payload.mobile as string | null),
      name:
        typeof data?.name === "string"
          ? data.name
          : payload.name === undefined
            ? fallbackUser.name ?? null
            : (payload.name as string | null),
      userType: typeof data?.userType === "string" ? data.userType : fallbackUser.userType,
      accountType:
        meta.accountType === "company" || meta.accountType === "personal"
          ? meta.accountType
          : fallbackUser.accountType ?? null,
      companyName:
        typeof meta.companyName === "string"
          ? meta.companyName
          : meta.companyName === null
            ? null
            : fallbackUser.companyName ?? null,
      primaryId:
        typeof meta.primaryId === "string"
          ? meta.primaryId
          : meta.primaryId === null
            ? null
            : fallbackUser.primaryId ?? null,
    };
  }

  async function submit() {
    if (!user) return;
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      toast.error("Email is required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("Enter a valid email address");
      return;
    }

    const payload = buildPayload();
    const hasChanges = Object.keys(payload).length > 0;

    if (!isInviteMode && !hasChanges) {
      toast.info("No changes to save");
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      let updated: EditableUser = { ...user, email: trimmedEmail };
      if (hasChanges) {
        const res = await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          throw new Error((data as { error?: string }).error || "Update failed");
        }
        updated = buildUpdatedUser(payload, data);
        onSaved?.(updated);
      }

      if (isInviteMode) {
        const inviteRes = await fetch(`/api/admin/users/${user.id}/invites`, { method: "POST" });
        const inviteData = (await inviteRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (!inviteRes.ok) {
          // The user record was already saved if there were changes; show that
          // but flag the invite failure so admin can retry.
          throw new Error((inviteData as { error?: string }).error || "Failed to send invite");
        }
        const inviteLink = typeof inviteData.inviteLink === "string" ? inviteData.inviteLink : undefined;
        const successMsg = `Invite sent to ${updated.email}`;
        if (inviteLink) {
          try {
            await navigator.clipboard.writeText(inviteLink);
            toast.success(`${successMsg}. Link also copied.`);
          } catch {
            toast.success(`${successMsg}.`);
          }
        } else {
          toast.success(successMsg);
        }
        onInviteSent?.(updated, inviteLink);
      } else {
        toast.success("Profile updated");
      }
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{descText}</p>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-user-email">Email</Label>
            <Input
              id="edit-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              placeholder="user@example.com"
              autoFocus={isInviteMode}
            />
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {isInviteMode ? "The invite link will be sent to this address." : "The user will sign in with this email."}
            </p>
            {hadPlaceholderEmail ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                No email is currently on file — enter a real address to enable login or invites.
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-user-mobile">Mobile</Label>
            <Input
              id="edit-user-mobile"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-user-name">Name</Label>
            <Input
              id="edit-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
            />
          </div>

          {isAgent && (
            <>
              <div className="grid gap-2">
                <Label>Agent Account Type</Label>
                <RadioGroup
                  value={accountType}
                  onValueChange={(v: string) => setAccountType(v === "company" ? "company" : "personal")}
                  className="flex flex-wrap gap-4"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="personal" id="edit-acct-personal" />
                    <span>Personal</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="company" id="edit-acct-company" />
                    <span>Company</span>
                  </label>
                </RadioGroup>
              </div>
              {accountType === "company" && (
                <div className="grid gap-2">
                  <Label htmlFor="edit-user-company">Company Name</Label>
                  <Input
                    id="edit-user-company"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Company legal name"
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="edit-user-primary-id">
                  {accountType === "company" ? "BR / CI Number" : "ID Number"}
                </Label>
                <Input
                  id="edit-user-primary-id"
                  value={primaryId}
                  onChange={(e) => setPrimaryId(e.target.value)}
                  placeholder={accountType === "company" ? "Business registration or CI number" : "HKID or personal ID"}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
