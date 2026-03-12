"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, FileText } from "lucide-react";
import type { PdfTemplateRow } from "@/lib/types/pdf-template";
import dynamic from "next/dynamic";

const PdfTemplateEditor = dynamic(
  () => import("./PdfTemplateEditor"),
  { ssr: false, loading: () => <div className="py-8 text-center text-sm text-neutral-500">Loading editor...</div> },
);

export default function PdfTemplateManager() {
  const [templates, setTemplates] = React.useState<PdfTemplateRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showUpload, setShowUpload] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);

  const [uploadLabel, setUploadLabel] = React.useState("");
  const [uploadDesc, setUploadDesc] = React.useState("");
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pdf-templates?_t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) setTemplates(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function handleUpload() {
    if (!uploadFile || !uploadLabel.trim()) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("label", uploadLabel.trim());
      fd.append("description", uploadDesc.trim());
      const res = await fetch("/api/pdf-templates", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      toast.success("Template uploaded");
      setShowUpload(false);
      setUploadLabel("");
      setUploadDesc("");
      setUploadFile(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
    setUploading(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this template?")) return;
    try {
      await fetch(`/api/pdf-templates/${id}`, { method: "DELETE" });
      toast.success("Deleted");
      load();
    } catch {
      toast.error("Delete failed");
    }
  }

  if (editingId !== null) {
    const tpl = templates.find((t) => t.id === editingId);
    if (!tpl) {
      setEditingId(null);
      return null;
    }
    return (
      <PdfTemplateEditor
        template={tpl}
        onClose={() => { setEditingId(null); load(); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600 dark:text-neutral-400">
          {loading ? "Loading..." : `${templates.length} template${templates.length !== 1 ? "s" : ""}`}
        </div>
        <Button size="sm" onClick={() => setShowUpload(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Upload Template</span>
        </Button>
      </div>

      {!loading && templates.length === 0 && (
        <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <FileText className="mx-auto mb-2 h-8 w-8 text-neutral-400 dark:text-neutral-500" />
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            No PDF templates yet. Upload a PDF to get started.
          </p>
        </div>
      )}

      {templates.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Pages</TableHead>
                <TableHead className="hidden sm:table-cell">Fields</TableHead>
                <TableHead className="hidden sm:table-cell">Description</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((tpl) => {
                const meta = tpl.meta as unknown as import("@/lib/types/pdf-template").PdfTemplateMeta | null;
                return (
                  <TableRow key={tpl.id}>
                    <TableCell className="font-medium">{tpl.label}</TableCell>
                    <TableCell className="hidden sm:table-cell">{meta?.pages?.length ?? 0}</TableCell>
                    <TableCell className="hidden sm:table-cell">{meta?.fields?.length ?? 0}</TableCell>
                    <TableCell className="hidden sm:table-cell text-neutral-500 dark:text-neutral-400 text-xs max-w-[200px] truncate">
                      {meta?.description || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon-xs" variant="ghost" onClick={() => setEditingId(tpl.id)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon-xs" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => handleDelete(tpl.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload PDF Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="tpl-label">Template Name</Label>
              <Input
                id="tpl-label"
                value={uploadLabel}
                onChange={(e) => setUploadLabel(e.target.value)}
                placeholder="e.g. Motor Insurance Invoice"
              />
            </div>
            <div>
              <Label htmlFor="tpl-desc">Description (optional)</Label>
              <Input
                id="tpl-desc"
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                placeholder="Brief description"
              />
            </div>
            <div>
              <Label htmlFor="tpl-file">PDF File</Label>
              <Input
                id="tpl-file"
                type="file"
                accept=".pdf"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading || !uploadFile || !uploadLabel.trim()}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
