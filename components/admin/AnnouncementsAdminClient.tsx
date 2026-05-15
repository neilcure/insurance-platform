"use client";

import * as React from "react";
import { toast } from "sonner";
import { Megaphone, Pencil, Trash2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { confirmDialog } from "@/components/ui/global-dialogs";
import { useT } from "@/lib/i18n";
import { useUserTypes } from "@/hooks/use-user-types";
import UserPicker, { EMPTY_USER_PICKER_VALUE, type UserPickerValue } from "@/components/shared/UserPicker";
import type { AnnouncementTargeting } from "@/db/schema/announcements";

type AnnouncementRow = {
  id: number;
  organisationId: number;
  title: string;
  bodyHtml: string;
  mediaKind: string;
  mediaStoredName: string | null;
  linkUrl: string | null;
  startsAt: string;
  endsAt: string;
  autoCloseSeconds: number | null;
  isActive: boolean;
  priority: number;
  targeting: AnnouncementTargeting;
};

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export default function AnnouncementsAdminClient() {
  const t = useT();
  const { options: userTypeOptions } = useUserTypes();

  const [rows, setRows] = React.useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [editingId, setEditingId] = React.useState<number | "new" | null>(null);

  const [title, setTitle] = React.useState("");
  const [bodyHtml, setBodyHtml] = React.useState("");
  const [linkUrl, setLinkUrl] = React.useState("");
  const [startsLocal, setStartsLocal] = React.useState("");
  const [endsLocal, setEndsLocal] = React.useState("");
  const [autoClose, setAutoClose] = React.useState("");
  const [priority, setPriority] = React.useState("0");
  const [isActive, setIsActive] = React.useState(true);

  const [targetMode, setTargetMode] = React.useState<"all" | "user_types" | "users">("all");
  const [selectedTypes, setSelectedTypes] = React.useState<Set<string>>(new Set());
  const [selectedPeople, setSelectedPeople] = React.useState<UserPickerValue>(EMPTY_USER_PICKER_VALUE);

  const [pendingMedia, setPendingMedia] = React.useState<{ storedName: string; mediaKind: "image" | "pdf" } | null>(
    null,
  );
  const [existingMediaCleared, setExistingMediaCleared] = React.useState(false);

  const resetFormDefaults = React.useCallback(() => {
    const now = new Date();
    const week = new Date(now.getTime() + 7 * 86400000);
    setTitle("");
    setBodyHtml("<p></p>");
    setLinkUrl("");
    setStartsLocal(toDatetimeLocalValue(now.toISOString()));
    setEndsLocal(toDatetimeLocalValue(week.toISOString()));
    setAutoClose("");
    setPriority("0");
    setIsActive(true);
    setTargetMode("all");
    setSelectedTypes(new Set());
    setSelectedPeople(EMPTY_USER_PICKER_VALUE);
    setPendingMedia(null);
    setExistingMediaCleared(false);
  }, []);

  const loadRows = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "load failed");
      setRows(Array.isArray(data) ? data : []);
    } catch {
      toast.error(t("admin.announcements.toastError", "Something went wrong"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function beginNew() {
    resetFormDefaults();
    setEditingId("new");
  }

  function beginEdit(row: AnnouncementRow) {
    setEditingId(row.id);
    setTitle(row.title);
    setBodyHtml(row.bodyHtml || "");
    setLinkUrl(row.linkUrl ?? "");
    setStartsLocal(toDatetimeLocalValue(row.startsAt));
    setEndsLocal(toDatetimeLocalValue(row.endsAt));
    setAutoClose(row.autoCloseSeconds != null ? String(row.autoCloseSeconds) : "");
    setPriority(String(row.priority ?? 0));
    setIsActive(row.isActive);
    const tg = row.targeting;
    if (tg.mode === "all") setTargetMode("all");
    else if (tg.mode === "user_types") {
      setTargetMode("user_types");
      setSelectedTypes(new Set(tg.userTypes));
    } else {
      setTargetMode("users");
      setSelectedPeople({
        userIds: [...tg.userIds].sort((a, b) => a - b),
        clientIds: [...(tg.clientIds ?? [])].sort((a, b) => a - b),
      });
    }
    setPendingMedia(null);
    setExistingMediaCleared(false);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function buildTargeting(): AnnouncementTargeting {
    if (targetMode === "all") return { mode: "all" };
    if (targetMode === "user_types") {
      const userTypes = [...selectedTypes];
      if (userTypes.length === 0) return { mode: "all" };
      return { mode: "user_types", userTypes };
    }
    const userIds = [...selectedPeople.userIds].sort((a, b) => a - b);
    const clientIds = [...selectedPeople.clientIds].sort((a, b) => a - b);
    if (userIds.length === 0 && clientIds.length === 0) return { mode: "all" };
    return clientIds.length > 0
      ? { mode: "users", userIds, clientIds }
      : { mode: "users", userIds };
  }

  const showUserPicker = editingId !== null && targetMode === "users";

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/admin/announcements/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "upload failed");
      setPendingMedia({ storedName: data.storedName, mediaKind: data.mediaKind });
      setExistingMediaCleared(false);
      toast.success(t("admin.announcements.mediaPreviewUploaded", "Media uploaded"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.announcements.toastError", "Something went wrong"));
    }
  }

  async function save() {
    const targeting = buildTargeting();
    let mediaKind: "none" | "image" | "pdf" = "none";
    let mediaStoredName: string | null = null;

    if (pendingMedia) {
      mediaKind = pendingMedia.mediaKind;
      mediaStoredName = pendingMedia.storedName;
    } else if (editingId !== "new" && typeof editingId === "number" && !existingMediaCleared) {
      const row = rows.find((r) => r.id === editingId);
      if (row && row.mediaKind !== "none" && row.mediaStoredName) {
        mediaKind = row.mediaKind as "image" | "pdf";
        mediaStoredName = row.mediaStoredName;
      }
    }

    let autoCloseSeconds: number | null = null;
    if (autoClose.trim() !== "") {
      const n = Number(autoClose);
      if (!Number.isFinite(n) || n < 0 || n > 3600) {
        toast.error(t("admin.announcements.toastError", "Something went wrong"));
        return;
      }
      autoCloseSeconds = Math.floor(n);
    }

    const payload = {
      title: title.trim(),
      bodyHtml,
      linkUrl: linkUrl.trim() || null,
      startsAt: fromDatetimeLocalValue(startsLocal),
      endsAt: fromDatetimeLocalValue(endsLocal),
      autoCloseSeconds,
      priority: Number(priority) || 0,
      isActive,
      targeting,
      mediaKind,
      mediaStoredName,
    };

    setSaving(true);
    try {
      if (editingId === "new") {
        const res = await fetch("/api/admin/announcements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "save failed");
      } else if (typeof editingId === "number") {
        const res = await fetch(`/api/admin/announcements/${editingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "save failed");
      }
      toast.success(t("admin.announcements.toastSaved", "Announcement saved"));
      setEditingId(null);
      await loadRows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.announcements.toastError", "Something went wrong"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: AnnouncementRow) {
    const ok = await confirmDialog({
      title: t("admin.announcements.confirmDeleteTitle", "Delete this announcement?"),
      description: t(
        "admin.announcements.confirmDeleteDescription",
        "Users who already dismissed it will not see it again; this removes it for everyone going forward.",
      ),
      confirmLabel: t("admin.announcements.deleteButton", "Delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/announcements/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      toast.success(t("admin.announcements.toastDeleted", "Announcement deleted"));
      await loadRows();
    } catch {
      toast.error(t("admin.announcements.toastError", "Something went wrong"));
    }
  }

  const editing = editingId !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl flex items-center gap-2">
            <Megaphone className="h-6 w-6 shrink-0" aria-hidden />
            {t("admin.announcements.title", "Announcements")}
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
            {t(
              "admin.announcements.subtitle",
              "Dashboard pop-ups for your organisation — audience, schedule, and optional poster or PDF.",
            )}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={beginNew} disabled={editing} className="shrink-0">
          {t("admin.announcements.newButton", "New announcement")}
        </Button>
      </div>

      {editing ? (
        <Card>
          <CardHeader className="p-3 sm:p-6">
            <CardTitle className="text-base sm:text-lg">
              {editingId === "new"
                ? t("admin.announcements.newButton", "New announcement")
                : t("admin.announcements.editButton", "Edit")}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {t(
                "admin.announcements.subtitle",
                "Dashboard pop-ups for your organisation — audience, schedule, and optional poster or PDF.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-3 pt-0 sm:p-6 sm:pt-0">
            <div className="grid gap-2">
              <Label>{t("admin.announcements.titleLabel", "Title")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label>{t("admin.announcements.bodyLabel", "Message (HTML)")}</Label>
              <textarea
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={8}
                className="flex min-h-[120px] w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {t(
                  "admin.announcements.bodyHelp",
                  "Basic HTML is allowed (paragraphs, bold, lists, links). Scripts are stripped.",
                )}
              </p>
            </div>

            <div className="grid gap-2">
              <Label>{t("admin.announcements.linkUrlLabel", "Optional link URL")}</Label>
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder={t("admin.announcements.linkUrlPlaceholder", "https://...")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>{t("admin.announcements.startsLabel", "Starts")}</Label>
                <Input type="datetime-local" value={startsLocal} onChange={(e) => setStartsLocal(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{t("admin.announcements.endsLabel", "Ends")}</Label>
                <Input type="datetime-local" value={endsLocal} onChange={(e) => setEndsLocal(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>{t("admin.announcements.autoCloseLabel", "Auto-close after (seconds)")}</Label>
                <Input
                  value={autoClose}
                  onChange={(e) => setAutoClose(e.target.value)}
                  inputMode="numeric"
                  placeholder={t("admin.announcements.autoClosePlaceholder", "e.g. 15")}
                />
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {t(
                    "admin.announcements.autoCloseHint",
                    "Leave empty to close only when the user clicks Close.",
                  )}
                </p>
              </div>
              <div className="grid gap-2">
                <Label>{t("admin.announcements.priorityLabel", "Priority (higher shows first)")}</Label>
                <Input value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              {t("admin.announcements.activeLabel", "Active")}
            </label>

            <div className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
              <Label>{t("admin.announcements.targetingLabel", "Audience")}</Label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="tgt"
                    checked={targetMode === "all"}
                    onChange={() => setTargetMode("all")}
                    className="accent-neutral-900 dark:accent-neutral-100"
                  />
                  {t("admin.announcements.targetingAll", "Everyone in this organisation")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="tgt"
                    checked={targetMode === "user_types"}
                    onChange={() => setTargetMode("user_types")}
                    className="accent-neutral-900 dark:accent-neutral-100"
                  />
                  {t("admin.announcements.targetingTypes", "Selected user types")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="tgt"
                    checked={targetMode === "users"}
                    onChange={() => setTargetMode("users")}
                    className="accent-neutral-900 dark:accent-neutral-100"
                  />
                  {t("admin.announcements.targetingUsers", "Specific user IDs")}
                </label>
              </div>

              {targetMode === "user_types" ? (
                <div className="flex flex-wrap gap-3 pt-2">
                  {userTypeOptions.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedTypes.has(opt.value)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedTypes((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(opt.value);
                            else next.delete(opt.value);
                            return next;
                          });
                        }}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {targetMode === "users" ? (
                <div className="pt-2">
                  <UserPicker
                    enabled={showUserPicker}
                    value={selectedPeople}
                    onChange={setSelectedPeople}
                    includeClientsWithoutLogin
                    helpText={t(
                      "admin.announcements.userPickerHelp",
                      "Tick the people who should see this pop-up. Clients without a login can be picked too — the announcement will appear automatically once they're invited as users.",
                    )}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="grid gap-2">
                <Label>{t("admin.announcements.uploadMedia", "Upload image or PDF")}</Label>
                <Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleUpload} />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="sm:mt-6"
                onClick={() => {
                  setPendingMedia(null);
                  setExistingMediaCleared(true);
                }}
              >
                {t("admin.announcements.clearMedia", "Remove media")}
              </Button>
            </div>
            {(pendingMedia ||
              (typeof editingId === "number" &&
                !existingMediaCleared &&
                rows.find((r) => r.id === editingId)?.mediaStoredName)) ? (
              <p className="text-xs text-green-600 dark:text-green-400">
                {t("admin.announcements.mediaPreviewUploaded", "Media uploaded — will show in the pop-up.")}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("admin.announcements.saveButton", "Save")}
              </Button>
              <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                {t("admin.announcements.cancelButton", "Cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="p-3 sm:p-6">
          <CardTitle className="text-base sm:text-lg">{t("admin.announcements.title", "Announcements")}</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading", "Loading…")}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-sm text-neutral-500">{t("admin.announcements.listEmpty", "No announcements yet.")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.announcements.columnTitle", "Title")}</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      {t("admin.announcements.columnSchedule", "Schedule")}
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      {t("admin.announcements.columnActive", "Active")}
                    </TableHead>
                    <TableHead className="text-right">{t("admin.announcements.columnActions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.title}</TableCell>
                      <TableCell className="hidden sm:table-cell whitespace-nowrap text-xs text-neutral-500">
                        {toDatetimeLocalValue(row.startsAt)} → {toDatetimeLocalValue(row.endsAt)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{row.isActive ? "✓" : "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => beginEdit(row)}
                            disabled={editing}
                            className="inline-flex items-center gap-1"
                          >
                            <Pencil className="h-4 w-4 sm:hidden lg:inline" />
                            <span className="hidden sm:inline">{t("admin.announcements.editButton", "Edit")}</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void remove(row)}
                            disabled={editing}
                            className="inline-flex items-center gap-1"
                          >
                            <Trash2 className="h-4 w-4 sm:hidden lg:inline" />
                            <span className="hidden sm:inline">{t("admin.announcements.deleteButton", "Delete")}</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
