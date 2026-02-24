"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pencil, Power, Trash2 } from "lucide-react";

export function ClientRowActions({
  id,
  isActive,
  showEdit = true,
  onToggle,
  onDeleted,
}: {
  id: number;
  isActive: boolean;
  showEdit?: boolean;
  onToggle?: (nextActive: boolean) => void;
  onDeleted?: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();
  const [active, setActive] = React.useState<boolean>(isActive);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState<string>("");
  const [primaryId, setPrimaryId] = React.useState<string>("");
  const [phone, setPhone] = React.useState<string>("");
  const [category, setCategory] = React.useState<"company" | "personal">("company");

  async function toggleActive() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !active }),
      });
      if (!res.ok) throw new Error(await res.text());
      const nowActive = !active;
      setActive(nowActive);
      toast.success(nowActive ? "Client enabled" : "Client disabled");
      if (onToggle) onToggle(nowActive);
      else router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    const ok = window.confirm("Delete this client? This cannot be undone.");
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Deleted");
      if (onDeleted) onDeleted();
      else router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {showEdit ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className="h-8 px-2 gap-1">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={toggleActive} disabled={busy} className="h-8 px-2 gap-1">
          <Power className="h-3.5 w-3.5" />
          {active ? "Disable" : "Enable"}
        </Button>
        <Button size="sm" variant="destructive" onClick={remove} disabled={busy} className="h-8 px-2 gap-1">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-sm text-neutral-600 dark:text-neutral-300">Category</label>
              <div className="mt-1 flex gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name={`cat-${id}`} checked={category === "company"} onChange={() => setCategory("company")} />
                  Company
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name={`cat-${id}`} checked={category === "personal"} onChange={() => setCategory("personal")} />
                  Personal
                </label>
              </div>
            </div>
            <div>
              <label className="text-sm text-neutral-600 dark:text-neutral-300">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-neutral-600 dark:text-neutral-300">Primary ID</label>
              <Input value={primaryId} onChange={(e) => setPrimaryId(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-neutral-600 dark:text-neutral-300">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  try {
                    const res = await fetch(`/api/clients/${id}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        displayName: name,
                        primaryId,
                        contactPhone: phone || null,
                        category,
                      }),
                    });
                    if (!res.ok) throw new Error(await res.text());
                    toast.success("Updated");
                    setOpen(false);
                    router.refresh();
                  } catch (err: any) {
                    toast.error(err?.message ?? "Update failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

