"use client";

import * as React from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ChevronLeft, Plus, Trash2, Save, GripVertical, Eye, Crosshair,
} from "lucide-react";
import type {
  PdfTemplateRow, PdfTemplateMeta, PdfFieldMapping,
} from "@/lib/types/pdf-template";
import {
  DATA_SOURCE_OPTIONS, FIELD_KEY_HINTS, FORMAT_OPTIONS,
} from "@/lib/types/pdf-template";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const DEFAULT_FONT_SIZE = 10;
const SCALE = 1.0;

type Props = {
  template: PdfTemplateRow;
  onClose: () => void;
};

export default function PdfTemplateEditor({ template, onClose }: Props) {
  const meta = template.meta as unknown as PdfTemplateMeta;
  const pdfUrl = `/api/pdf-templates/${template.id}/preview`;

  const [fields, setFields] = React.useState<PdfFieldMapping[]>(meta.fields ?? []);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [currentPage, setCurrentPage] = React.useState(0);
  const [placingMode, setPlacingMode] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [numPages, setNumPages] = React.useState(meta.pages?.length ?? 1);

  const pageContainerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);

  React.useEffect(() => {
    const el = pageContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const pageDims = meta.pages?.[currentPage];
  const pdfWidth = pageDims?.width ?? 595;
  const pdfHeight = pageDims?.height ?? 842;
  const displayWidth = containerWidth > 0 ? Math.min(containerWidth, 700) : 700;
  const scale = displayWidth / pdfWidth;
  const displayHeight = pdfHeight * scale;

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  function updateField(id: string, patch: Partial<PdfFieldMapping>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function deleteField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function handlePageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!placingMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const pdfX = clickX / scale;
    const pdfY = pdfHeight - clickY / scale;

    const newField: PdfFieldMapping = {
      id: crypto.randomUUID(),
      label: `Field ${fields.length + 1}`,
      page: currentPage,
      x: Math.round(pdfX * 100) / 100,
      y: Math.round(pdfY * 100) / 100,
      fontSize: DEFAULT_FONT_SIZE,
      source: "policy",
      fieldKey: "policyNumber",
      format: "text",
    };

    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
    setPlacingMode(false);
  }

  function handleFieldMouseDown(fieldId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedId(fieldId);

    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;

    const startScreenX = e.clientX;
    const startScreenY = e.clientY;
    const startPdfX = field.x;
    const startPdfY = field.y;

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startScreenX) / scale;
      const dy = (ev.clientY - startScreenY) / scale;
      updateField(fieldId, {
        x: Math.max(0, Math.round((startPdfX + dx) * 100) / 100),
        y: Math.max(0, Math.round((startPdfY - dy) * 100) / 100),
      });
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/pdf-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Fields saved");
    } catch {
      toast.error("Failed to save");
    }
    setSaving(false);
  }

  const pageFields = fields.filter((f) => f.page === currentPage);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onClose} className="gap-1">
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate">{template.label}</span>
        </div>
        <Button
          size="sm"
          variant={placingMode ? "default" : "outline"}
          onClick={() => setPlacingMode(!placingMode)}
          className="gap-1.5"
        >
          {placingMode ? <Crosshair className="h-3.5 w-3.5 animate-pulse" /> : <Plus className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{placingMode ? "Click on PDF..." : "Add Field"}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{saving ? "Saving..." : "Save"}</span>
        </Button>
      </div>

      {/* Page navigation */}
      {numPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500 dark:text-neutral-400">Page:</span>
          {Array.from({ length: numPages }, (_, i) => (
            <Button
              key={i}
              size="xs"
              variant={currentPage === i ? "default" : "outline"}
              onClick={() => setCurrentPage(i)}
            >
              {i + 1}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* PDF Preview with field overlays */}
        <div className="flex-1 min-w-0" ref={pageContainerRef}>
          <div
            className={`relative border border-neutral-300 dark:border-neutral-700 rounded-md overflow-hidden bg-neutral-100 dark:bg-neutral-800 ${
              placingMode ? "cursor-crosshair" : ""
            }`}
            style={{ width: displayWidth, height: displayHeight }}
            onClick={handlePageClick}
          >
            <Document
              file={pdfUrl}
              onLoadSuccess={({ numPages: n }) => setNumPages(n)}
              loading={<div className="flex items-center justify-center h-full text-sm text-neutral-500">Loading PDF...</div>}
              error={<div className="flex items-center justify-center h-full text-sm text-red-500 dark:text-red-400">Failed to load PDF</div>}
            >
              <Page
                pageNumber={currentPage + 1}
                width={displayWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </Document>

            {/* Field markers */}
            {pageFields.map((field) => {
              const screenX = field.x * scale;
              const screenY = (pdfHeight - field.y) * scale;
              const isSelected = field.id === selectedId;
              const fontSize = (field.fontSize ?? DEFAULT_FONT_SIZE) * scale;

              return (
                <div
                  key={field.id}
                  className={`absolute flex items-center gap-0.5 select-none group ${
                    isSelected
                      ? "z-20 ring-2 ring-blue-500"
                      : "z-10 hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-600"
                  }`}
                  style={{
                    left: screenX,
                    top: screenY - fontSize - 4,
                    cursor: "move",
                  }}
                  onMouseDown={(e) => handleFieldMouseDown(field.id, e)}
                >
                  <GripVertical className="h-3 w-3 text-blue-500 opacity-0 group-hover:opacity-100 shrink-0" />
                  <div
                    className={`px-1 rounded text-[10px] leading-tight whitespace-nowrap ${
                      isSelected
                        ? "bg-blue-500 text-white"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                    }`}
                    style={{ fontSize: Math.max(10, fontSize * 0.8) }}
                  >
                    {field.label || field.fieldKey}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Field configuration panel */}
        <div className="w-full lg:w-80 shrink-0 space-y-3">
          <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Fields on page {currentPage + 1} ({pageFields.length})
          </div>

          {/* Field list */}
          <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2 border-neutral-200 dark:border-neutral-800">
            {pageFields.length === 0 && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-2">
                No fields. Click &quot;Add Field&quot; then click on the PDF.
              </p>
            )}
            {pageFields.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                  f.id === selectedId
                    ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300"
                }`}
              >
                <span className="truncate">{f.label || f.fieldKey}</span>
                <span className="text-[10px] text-neutral-400 shrink-0">{f.source}</span>
              </button>
            ))}
          </div>

          {/* All-fields summary (across pages) */}
          {fields.length > pageFields.length && (
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Total across all pages: {fields.length} fields
            </div>
          )}

          {/* Selected field editor */}
          {selectedField && (
            <div className="border rounded-md p-3 space-y-3 border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Edit Field</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="text-red-600 dark:text-red-400"
                  onClick={() => deleteField(selectedField.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div>
                <Label className="text-xs">Label</Label>
                <Input
                  value={selectedField.label}
                  onChange={(e) => updateField(selectedField.id, { label: e.target.value })}
                  className="h-7 text-xs"
                />
              </div>

              <div>
                <Label className="text-xs">Data Source</Label>
                <select
                  value={selectedField.source}
                  onChange={(e) =>
                    updateField(selectedField.id, {
                      source: e.target.value as PdfFieldMapping["source"],
                      fieldKey: "",
                      packageName: undefined,
                    })
                  }
                  className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
                >
                  {DATA_SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {selectedField.source === "package" && (
                <div>
                  <Label className="text-xs">Package Name</Label>
                  <Input
                    value={selectedField.packageName ?? ""}
                    onChange={(e) => updateField(selectedField.id, { packageName: e.target.value })}
                    placeholder="e.g. vehicleinfo, policyinfo"
                    className="h-7 text-xs"
                  />
                </div>
              )}

              {selectedField.source === "static" ? (
                <div>
                  <Label className="text-xs">Static Value</Label>
                  <Input
                    value={selectedField.staticValue ?? ""}
                    onChange={(e) => updateField(selectedField.id, { staticValue: e.target.value })}
                    className="h-7 text-xs"
                  />
                </div>
              ) : (
                <div>
                  <Label className="text-xs">Field Key</Label>
                  <Input
                    value={selectedField.fieldKey}
                    onChange={(e) => updateField(selectedField.id, { fieldKey: e.target.value })}
                    placeholder="e.g. fullName"
                    className="h-7 text-xs"
                    list={`hints-${selectedField.id}`}
                  />
                  {FIELD_KEY_HINTS[selectedField.source]?.length > 0 && (
                    <datalist id={`hints-${selectedField.id}`}>
                      {FIELD_KEY_HINTS[selectedField.source].map((h) => (
                        <option key={h} value={h} />
                      ))}
                    </datalist>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Format</Label>
                  <select
                    value={selectedField.format ?? "text"}
                    onChange={(e) =>
                      updateField(selectedField.id, {
                        format: e.target.value as PdfFieldMapping["format"],
                      })
                    }
                    className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
                  >
                    {FORMAT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Font Size</Label>
                  <Input
                    type="number"
                    value={selectedField.fontSize ?? DEFAULT_FONT_SIZE}
                    onChange={(e) => updateField(selectedField.id, { fontSize: Number(e.target.value) || DEFAULT_FONT_SIZE })}
                    className="h-7 text-xs"
                    min={4}
                    max={72}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">X (pts)</Label>
                  <Input
                    type="number"
                    value={selectedField.x}
                    onChange={(e) => updateField(selectedField.id, { x: Number(e.target.value) || 0 })}
                    className="h-7 text-xs"
                    step={0.5}
                  />
                </div>
                <div>
                  <Label className="text-xs">Y (pts)</Label>
                  <Input
                    type="number"
                    value={selectedField.y}
                    onChange={(e) => updateField(selectedField.id, { y: Number(e.target.value) || 0 })}
                    className="h-7 text-xs"
                    step={0.5}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Max Width (pts)</Label>
                  <Input
                    type="number"
                    value={selectedField.width ?? ""}
                    onChange={(e) => updateField(selectedField.id, { width: e.target.value ? Number(e.target.value) : undefined })}
                    className="h-7 text-xs"
                    placeholder="auto"
                  />
                </div>
                <div>
                  <Label className="text-xs">Align</Label>
                  <select
                    value={selectedField.align ?? "left"}
                    onChange={(e) =>
                      updateField(selectedField.id, { align: e.target.value as PdfFieldMapping["align"] })
                    }
                    className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Prefix</Label>
                  <Input
                    value={selectedField.prefix ?? ""}
                    onChange={(e) => updateField(selectedField.id, { prefix: e.target.value })}
                    className="h-7 text-xs"
                    placeholder="e.g. $"
                  />
                </div>
                <div>
                  <Label className="text-xs">Suffix</Label>
                  <Input
                    value={selectedField.suffix ?? ""}
                    onChange={(e) => updateField(selectedField.id, { suffix: e.target.value })}
                    className="h-7 text-xs"
                    placeholder="e.g. %"
                  />
                </div>
              </div>

              {selectedField.format === "currency" && (
                <div>
                  <Label className="text-xs">Currency Code</Label>
                  <Input
                    value={selectedField.currencyCode ?? "HKD"}
                    onChange={(e) => updateField(selectedField.id, { currencyCode: e.target.value })}
                    className="h-7 text-xs"
                    placeholder="HKD"
                  />
                </div>
              )}

              <div>
                <Label className="text-xs">Font Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedField.fontColor ?? "#000000"}
                    onChange={(e) => updateField(selectedField.id, { fontColor: e.target.value })}
                    className="h-7 w-10 rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                  />
                  <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                    {selectedField.fontColor ?? "#000000"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
