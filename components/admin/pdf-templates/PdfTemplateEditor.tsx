"use client";

import * as React from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { toast } from "sonner";
import {
  ChevronLeft, Plus, Trash2, Save, Crosshair, Copy,
} from "lucide-react";
import type {
  PdfTemplateRow, PdfTemplateMeta, PdfFieldMapping,
} from "@/lib/types/pdf-template";
import {
  DATA_SOURCE_OPTIONS, FIELD_KEY_HINTS, FORMAT_OPTIONS,
} from "@/lib/types/pdf-template";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const DEFAULT_FONT_SIZE = 10;

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
  const displayWidth = containerWidth > 0 ? Math.min(containerWidth, 800) : 800;
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

  function duplicateField(field: PdfFieldMapping) {
    const dup: PdfFieldMapping = {
      ...field,
      id: crypto.randomUUID(),
      label: `${field.label} (copy)`,
      y: field.y - 15,
    };
    setFields((prev) => [...prev, dup]);
    setSelectedId(dup.id);
  }

  function addFieldAtCenter() {
    const newField: PdfFieldMapping = {
      id: crypto.randomUUID(),
      label: `Field ${fields.length + 1}`,
      page: currentPage,
      x: Math.round(pdfWidth * 0.1),
      y: Math.round(pdfHeight * 0.5),
      fontSize: DEFAULT_FONT_SIZE,
      source: "policy",
      fieldKey: "policyNumber",
      format: "text",
    };
    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
    setPlacingMode(false);
  }

  function handlePageClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const pdfX = clickX / scale;
    const pdfY = pdfHeight - clickY / scale;

    if (placingMode) {
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
    } else {
      setSelectedId(null);
    }
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
      onClose();
      return;
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
          variant="outline"
          onClick={addFieldAtCenter}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add Field</span>
        </Button>
        <Button
          size="sm"
          variant={placingMode ? "default" : "ghost"}
          onClick={() => setPlacingMode(!placingMode)}
          className="gap-1.5"
        >
          <Crosshair className={`h-3.5 w-3.5 ${placingMode ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline">{placingMode ? "Cancel" : "Place on PDF"}</span>
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

      {/* PDF Preview with field overlays */}
      <div ref={pageContainerRef}>
        <div
          className={`relative border border-neutral-300 dark:border-neutral-700 rounded-md overflow-hidden bg-neutral-100 dark:bg-neutral-800 mx-auto ${
            placingMode ? "cursor-crosshair" : ""
          }`}
          style={{ width: displayWidth, height: displayHeight }}
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

          {/* Transparent overlay to capture clicks in placing mode */}
          {placingMode && (
            <div
              className="absolute inset-0 z-30 cursor-crosshair"
              onClick={handlePageClick}
            >
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs px-3 py-1 rounded-full shadow-lg pointer-events-none animate-pulse">
                Click anywhere on the PDF to place a field
              </div>
            </div>
          )}

          {/* Field markers — sized to match actual PDF output */}
          {pageFields.map((field) => {
            const screenX = field.x * scale;
            const screenY = (pdfHeight - field.y) * scale;
            const isSelected = field.id === selectedId;
            const realFontPx = (field.fontSize ?? DEFAULT_FONT_SIZE) * scale;
            const fieldWidth = field.width ? field.width * scale : undefined;

            return (
              <div
                key={field.id}
                className={`absolute select-none group ${
                  isSelected ? "z-20" : "z-10"
                }`}
                style={{
                  left: screenX,
                  top: screenY - realFontPx,
                  cursor: "move",
                  width: fieldWidth,
                  minWidth: fieldWidth ? undefined : 20,
                }}
                onMouseDown={(e) => handleFieldMouseDown(field.id, e)}
              >
                <div
                  className={`border-b-2 whitespace-nowrap overflow-hidden ${
                    isSelected
                      ? "border-blue-500 bg-blue-500/15"
                      : "border-blue-400/60 bg-blue-400/10 group-hover:bg-blue-400/20"
                  }`}
                  style={{
                    fontSize: realFontPx,
                    lineHeight: `${realFontPx + 2}px`,
                    height: realFontPx + 4,
                    color: field.fontColor ?? "#000",
                    textAlign: field.align ?? "left",
                  }}
                >
                  <span className="opacity-60">{field.label || field.fieldKey}</span>
                </div>
                <div
                  className={`absolute left-0 px-1 rounded-b text-[9px] leading-none py-0.5 whitespace-nowrap transition-opacity ${
                    isSelected
                      ? "opacity-100 bg-blue-500 text-white"
                      : "opacity-0 group-hover:opacity-100 bg-blue-600 text-white"
                  }`}
                  style={{ top: "100%" }}
                >
                  {field.source === "package" ? `${field.packageName}.${field.fieldKey}` : field.source === "accounting" ? `accounting${field.lineKey ? `[${field.lineKey}]` : ""}.${field.fieldKey}` : `${field.source}.${field.fieldKey}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Field list below the PDF */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Fields on page {currentPage + 1} ({pageFields.length})
          </div>
          {fields.length > pageFields.length && (
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {fields.length} total across all pages
            </span>
          )}
        </div>

        <div className="max-h-52 overflow-y-auto space-y-0.5 border rounded-md p-1.5 border-neutral-200 dark:border-neutral-800">
          {pageFields.length === 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-3">
              No fields. Click &quot;Add Field&quot; then click on the PDF.
            </p>
          )}
          {pageFields.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedId(f.id)}
              className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                f.id === selectedId
                  ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300"
              }`}
            >
              <span className="truncate font-medium">{f.label || f.fieldKey}</span>
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">
                {f.source === "package" ? `${f.packageName}.${f.fieldKey}` : f.source === "accounting" ? `accounting${f.lineKey ? `[${f.lineKey}]` : ""}.${f.fieldKey}` : `${f.source}.${f.fieldKey}`}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Right-side drawer for field editing — only mounted when a field is selected */}
      {selectedField && (
        <SlideDrawer
          open
          onClose={() => setSelectedId(null)}
          title={`Edit: ${selectedField.label || selectedField.fieldKey}`}
          side="right"
          widthClass="w-[300px] sm:w-[340px]"
        >
          <div className="overflow-y-auto p-3 space-y-3 h-[calc(100%-49px)]">
            {/* Quick actions */}
            <div className="flex gap-1.5">
              <Button
                size="xs"
                variant="outline"
                className="gap-1 text-xs flex-1"
                onClick={() => duplicateField(selectedField)}
              >
                <Copy className="h-3 w-3" /> Duplicate
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="gap-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                onClick={() => deleteField(selectedField.id)}
              >
                <Trash2 className="h-3 w-3" /> Delete
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
                    lineKey: undefined,
                  })
                }
                className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
              >
                {DATA_SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                {DATA_SOURCE_OPTIONS.find((o) => o.value === selectedField.source)?.description}
              </p>
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

            {selectedField.source === "accounting" && (
              <div>
                <Label className="text-xs">Line Key</Label>
                <Input
                  value={selectedField.lineKey ?? ""}
                  onChange={(e) => updateField(selectedField.id, { lineKey: e.target.value })}
                  placeholder="e.g. tpo, own_vehicle_damage, main"
                  className="h-7 text-xs"
                />
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                  Which accounting section to pull from. Leave empty for the first/only line.
                </p>
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
                  <>
                    <datalist id={`hints-${selectedField.id}`}>
                      {FIELD_KEY_HINTS[selectedField.source].map((h) => (
                        <option key={h} value={h} />
                      ))}
                    </datalist>
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                      Suggestions: {FIELD_KEY_HINTS[selectedField.source].slice(0, 5).join(", ")}
                      {FIELD_KEY_HINTS[selectedField.source].length > 5 ? ", ..." : ""}
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Position &amp; Size</div>
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
              <div className="grid grid-cols-2 gap-2 mt-2">
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
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Appearance</div>
              <div className="grid grid-cols-2 gap-2">
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
                <div>
                  <Label className="text-xs">Font Color</Label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={selectedField.fontColor ?? "#000000"}
                      onChange={(e) => updateField(selectedField.id, { fontColor: e.target.value })}
                      className="h-7 w-8 rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                    />
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
                      {selectedField.fontColor ?? "#000000"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Formatting</div>
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

              {selectedField.format === "currency" && (
                <div className="mt-2">
                  <Label className="text-xs">Currency Code</Label>
                  <Input
                    value={selectedField.currencyCode ?? "HKD"}
                    onChange={(e) => updateField(selectedField.id, { currencyCode: e.target.value })}
                    className="h-7 text-xs"
                    placeholder="HKD"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mt-2">
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
            </div>

            {/* Save button pinned at bottom of drawer */}
            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 pb-1">
              <Button
                size="sm"
                className="w-full gap-1.5"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save All Fields"}
              </Button>
            </div>
          </div>
        </SlideDrawer>
      )}
    </div>
  );
}
