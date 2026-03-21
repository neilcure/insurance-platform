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
import { Plus, Trash2, Pencil, FileText, UploadCloud, FilePlus2 } from "lucide-react";
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
  const [showCreate, setShowCreate] = React.useState(false);
  const [createLabel, setCreateLabel] = React.useState("");
  const [createDesc, setCreateDesc] = React.useState("");
  const [creating, setCreating] = React.useState(false);

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

  async function handleCreateBlank() {
    if (!createLabel.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/pdf-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: createLabel.trim(), description: createDesc.trim(), blank: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Create failed");
      }
      const row = await res.json();
      toast.success("Template created");
      setShowCreate(false);
      setCreateLabel("");
      setCreateDesc("");
      await load();
      setEditingId(row.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    }
    setCreating(false);
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
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)} className="gap-1.5">
            <FilePlus2 className="h-4 w-4" />
            <span className="hidden sm:inline">Create Blank</span>
          </Button>
          <Button size="sm" onClick={() => setShowUpload(true)} className="gap-1.5">
            <UploadCloud className="h-4 w-4" />
            <span className="hidden sm:inline">Upload PDF</span>
          </Button>
        </div>
      </div>

      {!loading && templates.length === 0 && (
        <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <FileText className="mx-auto mb-2 h-8 w-8 text-neutral-400 dark:text-neutral-500" />
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            No PDF templates yet. Upload a PDF or create a blank template to get started.
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
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Upload an existing PDF to use as the base. You can then place data fields on top of it.
            </p>
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
              <Label>PDF File</Label>
              <label
                className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 cursor-pointer transition-colors ${
                  uploadFile
                    ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950"
                    : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-600"
                }`}
              >
                <UploadCloud className="h-6 w-6 text-neutral-400 dark:text-neutral-500" />
                {uploadFile ? (
                  <span className="text-sm text-blue-700 dark:text-blue-300 font-medium truncate max-w-full">
                    {uploadFile.name}
                  </span>
                ) : (
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">
                    Click to select a PDF file
                  </span>
                )}
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </label>
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Blank Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Start with blank pages. Add text, images, and snapshot data fields to build a document from scratch.
            </p>
            <div>
              <Label htmlFor="create-label">Template Name</Label>
              <Input
                id="create-label"
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder="e.g. Cover Letter, Policy Schedule"
              />
            </div>
            <div>
              <Label htmlFor="create-desc">Description (optional)</Label>
              <Input
                id="create-desc"
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Brief description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreateBlank} disabled={creating || !createLabel.trim()}>
              {creating ? "Creating..." : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
