"use client";

import * as React from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronDown, ChevronRight,
  Plus, Trash2, Save, Crosshair, Copy,
  FolderPlus, Pencil, Check, X,
} from "lucide-react";
import type {
  PdfTemplateRow, PdfTemplateMeta, PdfFieldMapping, PdfTemplateSection,
} from "@/lib/types/pdf-template";
import {
  DATA_SOURCE_OPTIONS, FIELD_KEY_HINTS, FORMAT_OPTIONS,
  SECTION_COLORS,
} from "@/lib/types/pdf-template";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const DEFAULT_FONT_SIZE = 10;

type SectionField = { label: string; fieldKey: string; format?: PdfFieldMapping["format"]; defaultOn?: boolean };

const SECTION_TEMPLATES: {
  name: string;
  source: PdfFieldMapping["source"];
  color: string;
  fields: SectionField[];
}[] = [
  {
    name: "Insured",
    source: "insured",
    color: "#3b82f6",
    fields: [
      { label: "Insured Type", fieldKey: "insuredType", defaultOn: true },
      { label: "Display Name", fieldKey: "displayName", defaultOn: true },
      { label: "ID Number", fieldKey: "idNumber", defaultOn: true },
      { label: "Company Name", fieldKey: "companyName", defaultOn: true },
      { label: "BR Number", fieldKey: "brNumber", defaultOn: true },
      { label: "Full Name", fieldKey: "fullName" },
      { label: "Last Name", fieldKey: "lastName" },
      { label: "First Name", fieldKey: "firstName" },
      { label: "Primary ID", fieldKey: "primaryId" },
      { label: "Organisation Name", fieldKey: "organisationName" },
      { label: "Has Driving License", fieldKey: "hasDrivingLicense" },
    ],
  },
  {
    name: "Contact Information",
    source: "contactinfo",
    color: "#10b981",
    fields: [
      { label: "Personal Title", fieldKey: "personalTitle", defaultOn: true },
      { label: "Name", fieldKey: "name", defaultOn: true },
      { label: "Tel", fieldKey: "tel", defaultOn: true },
      { label: "Mobile", fieldKey: "mobile", defaultOn: true },
      { label: "Fax", fieldKey: "fax" },
      { label: "Email", fieldKey: "email", defaultOn: true },
      { label: "Full Address", fieldKey: "fullAddress", defaultOn: true },
      { label: "Flat Number", fieldKey: "flatNumber" },
      { label: "Floor Number", fieldKey: "floorNumber" },
      { label: "Block Number", fieldKey: "blockNumber" },
      { label: "Block Name", fieldKey: "blockName" },
      { label: "Street Number", fieldKey: "streetNumber" },
      { label: "Street Name", fieldKey: "streetName" },
      { label: "Property Name", fieldKey: "propertyName" },
      { label: "District Name", fieldKey: "districtName" },
      { label: "Area", fieldKey: "area" },
    ],
  },
  {
    name: "Policy",
    source: "policy",
    color: "#f59e0b",
    fields: [
      { label: "Policy Number", fieldKey: "policyNumber", defaultOn: true },
      { label: "Created Date", fieldKey: "createdAt", format: "date", defaultOn: true },
    ],
  },
  {
    name: "Accounting",
    source: "accounting",
    color: "#ef4444",
    fields: [
      { label: "Gross Premium", fieldKey: "grossPremium", format: "currency", defaultOn: true },
      { label: "Net Premium", fieldKey: "netPremium", format: "currency", defaultOn: true },
      { label: "Client Premium", fieldKey: "clientPremium", format: "currency", defaultOn: true },
      { label: "Agent Commission", fieldKey: "agentCommission", format: "currency", defaultOn: true },
      { label: "Commission Rate", fieldKey: "commissionRate" },
      { label: "Currency", fieldKey: "currency" },
      { label: "Margin", fieldKey: "margin" },
      { label: "Line Label", fieldKey: "lineLabel" },
      { label: "Insurer Name", fieldKey: "insurerName" },
      { label: "Insurer Contact Name", fieldKey: "insurerContactName" },
      { label: "Insurer Contact Email", fieldKey: "insurerContactEmail" },
      { label: "Insurer Contact Phone", fieldKey: "insurerContactPhone" },
      { label: "Insurer Address", fieldKey: "insurerAddress" },
      { label: "Collaborator Name", fieldKey: "collaboratorName" },
    ],
  },
  {
    name: "Agent",
    source: "agent",
    color: "#8b5cf6",
    fields: [
      { label: "Agent Name", fieldKey: "name", defaultOn: true },
      { label: "Agent Email", fieldKey: "email", defaultOn: true },
      { label: "User Number", fieldKey: "userNumber", defaultOn: true },
    ],
  },
  {
    name: "Client",
    source: "client",
    color: "#ec4899",
    fields: [
      { label: "Client Number", fieldKey: "clientNumber", defaultOn: true },
      { label: "Display Name", fieldKey: "displayName", defaultOn: true },
      { label: "Primary ID", fieldKey: "primaryId", defaultOn: true },
      { label: "Category", fieldKey: "category" },
      { label: "Contact Phone", fieldKey: "contactPhone", defaultOn: true },
    ],
  },
  {
    name: "Organisation / Insurer",
    source: "organisation",
    color: "#06b6d4",
    fields: [
      { label: "Company Name", fieldKey: "name", defaultOn: true },
      { label: "Contact Name", fieldKey: "contactName", defaultOn: true },
      { label: "Contact Email", fieldKey: "contactEmail", defaultOn: true },
      { label: "Contact Phone", fieldKey: "contactPhone", defaultOn: true },
      { label: "Full Address", fieldKey: "fullAddress", defaultOn: true },
      { label: "Flat Number", fieldKey: "flatNumber" },
      { label: "Floor Number", fieldKey: "floorNumber" },
      { label: "Block Number", fieldKey: "blockNumber" },
      { label: "Block Name", fieldKey: "blockName" },
      { label: "Street Number", fieldKey: "streetNumber" },
      { label: "Street Name", fieldKey: "streetName" },
      { label: "Property Name", fieldKey: "propertyName" },
      { label: "District Name", fieldKey: "districtName" },
      { label: "Area", fieldKey: "area" },
    ],
  },
];

function FieldListItem({
  field,
  isSelected,
  isMultiSelected,
  sectionColor,
  onSelect,
  onCtrlClick,
}: {
  field: PdfFieldMapping;
  isSelected: boolean;
  isMultiSelected: boolean;
  sectionColor?: string;
  onSelect: () => void;
  onCtrlClick: () => void;
}) {
  const tag =
    field.source === "package"
      ? `${field.packageName}.${field.fieldKey}`
      : field.source === "accounting"
        ? `accounting${field.lineKey ? `[${field.lineKey}]` : ""}.${field.fieldKey}`
        : `${field.source}.${field.fieldKey}`;

  return (
    <button
      type="button"
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) { onCtrlClick(); return; }
        onSelect();
      }}
      className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
        isSelected
          ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700"
          : isMultiSelected
            ? "bg-blue-50/60 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 ring-1 ring-dashed ring-blue-200 dark:ring-blue-800"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300"
      }`}
    >
      {sectionColor && (
        <div className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: sectionColor }} />
      )}
      <span className="truncate font-medium flex-1">{field.label || field.fieldKey}</span>
      <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">{tag}</span>
    </button>
  );
}

type Props = {
  template: PdfTemplateRow;
  onClose: () => void;
};

export default function PdfTemplateEditor({ template, onClose }: Props) {
  const meta = template.meta as unknown as PdfTemplateMeta;
  const pdfUrl = `/api/pdf-templates/${template.id}/preview`;

  const [fields, setFields] = React.useState<PdfFieldMapping[]>(meta.fields ?? []);
  const [sections, setSections] = React.useState<PdfTemplateSection[]>(meta.sections ?? []);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [currentPage, setCurrentPage] = React.useState(0);
  const [placingMode, setPlacingMode] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [numPages, setNumPages] = React.useState(meta.pages?.length ?? 1);
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());
  const [renamingSectionId, setRenamingSectionId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [showSectionPicker, setShowSectionPicker] = React.useState(false);
  const [sectionPickerTemplate, setSectionPickerTemplate] = React.useState<typeof SECTION_TEMPLATES[number] | null>(null);
  const [fieldSelections, setFieldSelections] = React.useState<Record<string, { checked: boolean; showLabel: boolean }>>({});
  const [sectionLabelColor, setSectionLabelColor] = React.useState("#6b7280");
  const [sectionDataColor, setSectionDataColor] = React.useState("#000000");
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = React.useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = React.useState<Set<string>>(new Set());
  const savedRef = React.useRef({ fields: meta.fields ?? [], sections: meta.sections ?? [] });
  const isDirty = JSON.stringify(fields) !== JSON.stringify(savedRef.current.fields)
    || JSON.stringify(sections) !== JSON.stringify(savedRef.current.sections);

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

  function getSectionColor(sectionId?: string): string {
    if (!sectionId) return "#3b82f6";
    return sections.find((s) => s.id === sectionId)?.color ?? "#3b82f6";
  }

  function toggleSectionCollapse(sectionId: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function openSectionConfig(tpl: typeof SECTION_TEMPLATES[number]) {
    setEditingSectionId(null);
    setSectionPickerTemplate(tpl);
    const selections: Record<string, { checked: boolean; showLabel: boolean }> = {};
    tpl.fields.forEach((f) => {
      selections[f.fieldKey] = { checked: false, showLabel: false };
    });
    setFieldSelections(selections);
    setSectionLabelColor("#6b7280");
    setSectionDataColor("#000000");
    setShowSectionPicker(false);
  }

  function openSectionEdit(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;

    const sectionFields = fields.filter((f) => f.sectionId === sectionId && f.source !== "static");
    const source = sectionFields[0]?.source;
    const tpl = SECTION_TEMPLATES.find((t) => t.source === source) ?? SECTION_TEMPLATES.find((t) => t.name === section.name);
    if (!tpl) return;

    const existingKeys = new Set(sectionFields.map((f) => f.fieldKey));
    const sectionStaticFields = fields.filter((f) => f.sectionId === sectionId && f.source === "static");
    const labelledKeys = new Set(
      sectionStaticFields.map((f) => {
        const match = tpl.fields.find((tf) => `${tf.label}:` === f.staticValue);
        return match?.fieldKey;
      }).filter(Boolean) as string[],
    );

    const selections: Record<string, { checked: boolean; showLabel: boolean }> = {};
    tpl.fields.forEach((f) => {
      selections[f.fieldKey] = {
        checked: existingKeys.has(f.fieldKey),
        showLabel: labelledKeys.has(f.fieldKey),
      };
    });

    const labelField = sectionStaticFields[0];
    const dataField = sectionFields[0];
    setSectionLabelColor(labelField?.fontColor ?? "#6b7280");
    setSectionDataColor(dataField?.fontColor ?? "#000000");

    setEditingSectionId(sectionId);
    setSectionPickerTemplate(tpl);
    setFieldSelections(selections);
  }

  function toggleFieldSel(fieldKey: string, prop: "checked" | "showLabel") {
    setFieldSelections((prev) => ({
      ...prev,
      [fieldKey]: { ...prev[fieldKey], [prop]: !prev[fieldKey]?.[prop] },
    }));
  }

  function buildSectionFields(
    tpl: typeof SECTION_TEMPLATES[number],
    sectionId: string,
    startY: number,
  ): PdfFieldMapping[] {
    const startX = Math.round(pdfWidth * 0.1);
    const spacing = 18;
    const labelOffset = 100;
    const picked = tpl.fields.filter((f) => fieldSelections[f.fieldKey]?.checked);
    const result: PdfFieldMapping[] = [];

    picked.forEach((f, i) => {
      const yPos = startY - i * spacing;
      const sel = fieldSelections[f.fieldKey];

      if (sel?.showLabel) {
        result.push({
          id: crypto.randomUUID(),
          label: `${f.label} (label)`,
          page: currentPage,
          x: startX,
          y: yPos,
          fontSize: DEFAULT_FONT_SIZE,
          fontColor: sectionLabelColor,
          source: "static",
          fieldKey: "static",
          staticValue: `${f.label}:`,
          sectionId,
          format: "text",
        });
        result.push({
          id: crypto.randomUUID(),
          label: f.label,
          page: currentPage,
          x: startX + labelOffset,
          y: yPos,
          fontSize: DEFAULT_FONT_SIZE,
          fontColor: sectionDataColor !== "#000000" ? sectionDataColor : undefined,
          source: tpl.source,
          fieldKey: f.fieldKey,
          sectionId,
          format: f.format ?? "text",
        });
      } else {
        result.push({
          id: crypto.randomUUID(),
          label: f.label,
          page: currentPage,
          x: startX,
          y: yPos,
          fontSize: DEFAULT_FONT_SIZE,
          fontColor: sectionDataColor !== "#000000" ? sectionDataColor : undefined,
          source: tpl.source,
          fieldKey: f.fieldKey,
          sectionId,
          format: f.format ?? "text",
        });
      }
    });

    return result;
  }

  function confirmSectionAdd() {
    if (!sectionPickerTemplate) return;
    const tpl = sectionPickerTemplate;

    if (editingSectionId) {
      const sid = editingSectionId;
      const existing = fields.filter((f) => f.sectionId === sid);
      const existingDataKeys = new Set(
        existing.filter((f) => f.source !== "static").map((f) => f.fieldKey),
      );

      const uncheckedKeys = new Set(
        tpl.fields.filter((f) => !fieldSelections[f.fieldKey]?.checked).map((f) => f.fieldKey),
      );

      const idsToRemove = new Set<string>();
      existing.forEach((ef) => {
        if (ef.source === "static") {
          const match = tpl.fields.find((tf) => `${tf.label}:` === ef.staticValue);
          if (match && uncheckedKeys.has(match.fieldKey)) idsToRemove.add(ef.id);
        } else if (uncheckedKeys.has(ef.fieldKey)) {
          idsToRemove.add(ef.id);
        }
      });

      const newlyChecked = tpl.fields.filter(
        (f) => fieldSelections[f.fieldKey]?.checked && !existingDataKeys.has(f.fieldKey),
      );

      let addedFields: PdfFieldMapping[] = [];
      if (newlyChecked.length > 0) {
        const tempSelections = { ...fieldSelections };
        tpl.fields.forEach((f) => {
          if (!newlyChecked.some((nc) => nc.fieldKey === f.fieldKey)) {
            tempSelections[f.fieldKey] = { ...tempSelections[f.fieldKey], checked: false };
          }
        });
        const origSelections = fieldSelections;
        setFieldSelections(tempSelections);
        addedFields = buildSectionFields(tpl, sid, Math.round(pdfHeight * 0.5));
        setFieldSelections(origSelections);

        addedFields = newlyChecked.flatMap((f, i) => {
          const yPos = Math.round(pdfHeight * 0.5) - i * 18;
          const sel = fieldSelections[f.fieldKey];
          const startX = Math.round(pdfWidth * 0.1);
          const result: PdfFieldMapping[] = [];
          if (sel?.showLabel) {
            result.push({
              id: crypto.randomUUID(),
              label: `${f.label} (label)`,
              page: currentPage,
              x: startX,
              y: yPos,
              fontSize: DEFAULT_FONT_SIZE,
              fontColor: sectionLabelColor,
              source: "static",
              fieldKey: "static",
              staticValue: `${f.label}:`,
              sectionId: sid,
              format: "text",
            });
            result.push({
              id: crypto.randomUUID(),
              label: f.label,
              page: currentPage,
              x: startX + 100,
              y: yPos,
              fontSize: DEFAULT_FONT_SIZE,
              fontColor: sectionDataColor !== "#000000" ? sectionDataColor : undefined,
              source: tpl.source,
              fieldKey: f.fieldKey,
              sectionId: sid,
              format: f.format ?? "text",
            });
          } else {
            result.push({
              id: crypto.randomUUID(),
              label: f.label,
              page: currentPage,
              x: startX,
              y: yPos,
              fontSize: DEFAULT_FONT_SIZE,
              fontColor: sectionDataColor !== "#000000" ? sectionDataColor : undefined,
              source: tpl.source,
              fieldKey: f.fieldKey,
              sectionId: sid,
              format: f.format ?? "text",
            });
          }
          return result;
        });
      }

      setFields((prev) => [...prev.filter((f) => !idsToRemove.has(f.id)), ...addedFields]);
      setEditingSectionId(null);
      setSectionPickerTemplate(null);
      return;
    }

    const sectionId = crypto.randomUUID();
    setSections((prev) => [...prev, { id: sectionId, name: tpl.name, color: tpl.color }]);
    const newFields = buildSectionFields(tpl, sectionId, Math.round(pdfHeight * 0.85));
    setFields((prev) => [...prev, ...newFields]);
    setSectionPickerTemplate(null);
    if (newFields.length > 0) setSelectedId(newFields[0].id);
  }

  function addEmptySection() {
    const usedColors = new Set(sections.map((s) => s.color));
    const nextColor = SECTION_COLORS.find((c) => !usedColors.has(c)) ?? SECTION_COLORS[sections.length % SECTION_COLORS.length];
    const newSection: PdfTemplateSection = {
      id: crypto.randomUUID(),
      name: `Section ${sections.length + 1}`,
      color: nextColor,
    };
    setSections((prev) => [...prev, newSection]);
    setRenamingSectionId(newSection.id);
    setRenameValue(newSection.name);
    setShowSectionPicker(false);
  }

  function addAnotherField() {
    const ref = selectedField;
    const newField: PdfFieldMapping = {
      id: crypto.randomUUID(),
      label: `Field ${fields.length + 1}`,
      page: currentPage,
      x: ref ? ref.x : Math.round(pdfWidth * 0.1),
      y: ref ? ref.y - 18 : Math.round(pdfHeight * 0.5),
      fontSize: ref?.fontSize ?? DEFAULT_FONT_SIZE,
      source: ref?.source ?? "policy",
      fieldKey: "",
      sectionId: ref?.sectionId,
      format: "text",
    };
    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
  }

  function renameSection(id: string, name: string) {
    if (!name.trim()) return;
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)));
    setRenamingSectionId(null);
  }

  function deleteSection(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id));
    setFields((prev) => prev.filter((f) => f.sectionId !== id));
    if (selectedId && fields.find((f) => f.id === selectedId)?.sectionId === id) {
      setSelectedId(null);
    }
  }

  function cycleSectionColor(id: string) {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const idx = SECTION_COLORS.indexOf(s.color);
        return { ...s, color: SECTION_COLORS[(idx + 1) % SECTION_COLORS.length] };
      }),
    );
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
      setMultiSelectedIds(new Set());
    }
  }

  function handleFieldMouseDown(fieldId: string, e: React.MouseEvent) {
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      setMultiSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(fieldId)) next.delete(fieldId);
        else next.add(fieldId);
        return next;
      });
      return;
    }

    const isGroupDrag = multiSelectedIds.has(fieldId) && multiSelectedIds.size > 1;
    const dragIds = isGroupDrag ? [...multiSelectedIds] : [fieldId];
    const startPositions = dragIds.map((id) => {
      const f = fields.find((ff) => ff.id === id);
      return { id, x: f?.x ?? 0, y: f?.y ?? 0 };
    });

    const startScreenX = e.clientX;
    const startScreenY = e.clientY;
    let dragged = false;
    setDraggingId(fieldId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startScreenX) / scale;
      const dy = (ev.clientY - startScreenY) / scale;
      if (!dragged && Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      setFields((prev) =>
        prev.map((f) => {
          const sp = startPositions.find((s) => s.id === f.id);
          if (!sp) return f;
          return {
            ...f,
            x: Math.max(0, Math.round((sp.x + dx) * 100) / 100),
            y: Math.max(0, Math.round((sp.y - dy) * 100) / 100),
          };
        }),
      );
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggingId(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleFieldDoubleClick(fieldId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedId(fieldId);
  }

  function selectSectionFields(sectionId: string) {
    const ids = fields.filter((f) => f.sectionId === sectionId && f.page === currentPage).map((f) => f.id);
    setMultiSelectedIds(new Set(ids));
  }

  function alignFields(dir: "left" | "right" | "top" | "bottom" | "dist-v" | "dist-h") {
    const ids = [...multiSelectedIds];
    const sel = fields.filter((f) => ids.includes(f.id));
    if (sel.length < 2) return;

    switch (dir) {
      case "left": {
        const minX = Math.min(...sel.map((f) => f.x));
        setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, x: minX } : f)));
        break;
      }
      case "right": {
        const maxX = Math.max(...sel.map((f) => f.x));
        setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, x: maxX } : f)));
        break;
      }
      case "top": {
        const maxY = Math.max(...sel.map((f) => f.y));
        setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, y: maxY } : f)));
        break;
      }
      case "bottom": {
        const minY = Math.min(...sel.map((f) => f.y));
        setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, y: minY } : f)));
        break;
      }
      case "dist-v": {
        const sorted = [...sel].sort((a, b) => b.y - a.y);
        const topY = sorted[0].y;
        const bottomY = sorted[sorted.length - 1].y;
        const step = (topY - bottomY) / (sorted.length - 1);
        const updates = new Map(sorted.map((f, i) => [f.id, topY - i * step]));
        setFields((prev) =>
          prev.map((f) => {
            const newY = updates.get(f.id);
            return newY !== undefined ? { ...f, y: Math.round(newY * 100) / 100 } : f;
          }),
        );
        break;
      }
      case "dist-h": {
        const sorted = [...sel].sort((a, b) => a.x - b.x);
        const leftX = sorted[0].x;
        const rightX = sorted[sorted.length - 1].x;
        const step = (rightX - leftX) / (sorted.length - 1);
        const updates = new Map(sorted.map((f, i) => [f.id, leftX + i * step]));
        setFields((prev) =>
          prev.map((f) => {
            const newX = updates.get(f.id);
            return newX !== undefined ? { ...f, x: Math.round(newX * 100) / 100 } : f;
          }),
        );
        break;
      }
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/pdf-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, sections }),
      });
      if (!res.ok) throw new Error("Save failed");
      savedRef.current = { fields, sections };
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
        <Button
          size="sm"
          variant={isDirty ? "default" : "outline"}
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{saving ? "Saving..." : isDirty ? "Save *" : "Save"}</span>
          {isDirty && <span className="sm:hidden w-1.5 h-1.5 rounded-full bg-white" />}
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

          {/* Field markers — sized to match actual PDF output, colored by section */}
          {pageFields.map((field) => {
            const screenX = field.x * scale;
            const screenY = (pdfHeight - field.y) * scale;
            const isSelected = field.id === selectedId;
            const isDragging = field.id === draggingId;
            const isMultiSel = multiSelectedIds.has(field.id);
            const realFontPx = (field.fontSize ?? DEFAULT_FONT_SIZE) * scale;
            const fieldWidth = field.width ? field.width * scale : undefined;
            const sColor = getSectionColor(field.sectionId);

            return (
              <div
                key={field.id}
                className={`absolute select-none group ${
                  isSelected || isDragging || isMultiSel ? "z-20" : "z-10"
                }`}
                style={{
                  left: screenX,
                  top: screenY - realFontPx,
                  cursor: "move",
                  width: fieldWidth,
                  minWidth: fieldWidth ? undefined : 20,
                  outline: isMultiSel ? `2px dashed ${sColor}` : undefined,
                  outlineOffset: 1,
                }}
                onMouseDown={(e) => handleFieldMouseDown(field.id, e)}
                onDoubleClick={(e) => handleFieldDoubleClick(field.id, e)}
              >
                <div
                  className="border-b-2 whitespace-nowrap overflow-hidden"
                  style={{
                    fontSize: realFontPx,
                    lineHeight: `${realFontPx + 2}px`,
                    height: realFontPx + 4,
                    color: field.fontColor ?? "#000",
                    textAlign: field.align ?? "left",
                    borderColor: sColor,
                    backgroundColor: isSelected || isDragging || isMultiSel ? `${sColor}26` : `${sColor}1a`,
                  }}
                >
                  <span className="opacity-60">{field.label || field.fieldKey}</span>
                </div>
                <div
                  className={`absolute left-0 px-1 rounded-b text-[9px] leading-none py-0.5 whitespace-nowrap transition-opacity text-white ${
                    isSelected || isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  style={{
                    top: "100%",
                    backgroundColor: sColor,
                  }}
                >
                  {field.source === "package" ? `${field.packageName}.${field.fieldKey}` : field.source === "accounting" ? `accounting${field.lineKey ? `[${field.lineKey}]` : ""}.${field.fieldKey}` : `${field.source}.${field.fieldKey}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section-grouped field list below the PDF */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Fields on page {currentPage + 1} ({pageFields.length})
          </div>
          <div className="flex items-center gap-2">
            {fields.length > pageFields.length && (
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {fields.length} total across all pages
              </span>
            )}
            <div className="relative">
              <Button size="xs" variant="outline" onClick={() => setShowSectionPicker(!showSectionPicker)} className="gap-1 text-xs">
                <FolderPlus className="h-3 w-3" /> Add Section
              </Button>
              {showSectionPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSectionPicker(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-60 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg py-1">
                    {SECTION_TEMPLATES.map((tpl) => {
                      const defaultCount = tpl.fields.filter((f) => f.defaultOn).length;
                      return (
                        <button
                          key={tpl.name}
                          type="button"
                          onClick={() => openSectionConfig(tpl)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                        >
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tpl.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{tpl.name}</div>
                            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">{tpl.fields.length} fields ({defaultCount} default)</div>
                          </div>
                        </button>
                      );
                    })}
                    <div className="border-t border-neutral-200 dark:border-neutral-800 my-1" />
                    <button
                      type="button"
                      onClick={addEmptySection}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Custom Section (empty)</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {multiSelectedIds.size >= 2 && (
          <div className="flex items-center gap-1 flex-wrap rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-2 py-1.5">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300 mr-1">{multiSelectedIds.size} selected</span>
            <div className="flex items-center gap-0.5">
              <Button size="xs" variant="outline" onClick={() => alignFields("left")} className="text-[10px] h-6 px-1.5" title="Align left edges">⫷ Left</Button>
              <Button size="xs" variant="outline" onClick={() => alignFields("right")} className="text-[10px] h-6 px-1.5" title="Align right edges">Right ⫸</Button>
              <Button size="xs" variant="outline" onClick={() => alignFields("top")} className="text-[10px] h-6 px-1.5" title="Align top edges">⏶ Top</Button>
              <Button size="xs" variant="outline" onClick={() => alignFields("bottom")} className="text-[10px] h-6 px-1.5" title="Align bottom edges">⏷ Bot</Button>
              <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
              <Button size="xs" variant="outline" onClick={() => alignFields("dist-h")} className="text-[10px] h-6 px-1.5" title="Distribute horizontally">↔ Space H</Button>
              <Button size="xs" variant="outline" onClick={() => alignFields("dist-v")} className="text-[10px] h-6 px-1.5" title="Distribute vertically">↕ Space V</Button>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setMultiSelectedIds(new Set())} className="text-[10px] h-6 px-1.5 ml-auto text-neutral-500">Clear</Button>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto space-y-1 border rounded-md p-1.5 border-neutral-200 dark:border-neutral-800">
          {pageFields.length === 0 && sections.length === 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-3">
              No fields. Click &quot;Add Field&quot; then click on the PDF.
            </p>
          )}

          {/* Render each section */}
          {sections.map((section) => {
            const sectionFields = pageFields.filter((f) => f.sectionId === section.id);
            const isCollapsed = collapsedSections.has(section.id);
            const isRenaming = renamingSectionId === section.id;

            return (
              <div key={section.id} className="rounded border border-neutral-200 dark:border-neutral-800">
                {/* Section header */}
                <div
                  className="flex items-center gap-1.5 px-2 py-1.5 bg-neutral-50 dark:bg-neutral-900 rounded-t cursor-pointer select-none"
                  onClick={() => !isRenaming && toggleSectionCollapse(section.id)}
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: section.color }} />
                  {isCollapsed ? <ChevronRight className="h-3 w-3 text-neutral-400" /> : <ChevronDown className="h-3 w-3 text-neutral-400" />}

                  {isRenaming ? (
                    <form
                      className="flex items-center gap-1 flex-1 min-w-0"
                      onSubmit={(e) => { e.preventDefault(); renameSection(section.id, renameValue); }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-5 text-xs flex-1"
                        autoFocus
                        onBlur={() => renameSection(section.id, renameValue)}
                      />
                      <button type="submit" className="p-0.5 text-green-600 dark:text-green-400 hover:opacity-80">
                        <Check className="h-3 w-3" />
                      </button>
                      <button type="button" className="p-0.5 text-neutral-400 hover:opacity-80" onClick={() => setRenamingSectionId(null)}>
                        <X className="h-3 w-3" />
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 flex-1 truncate">
                      {section.name}
                    </span>
                  )}

                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">{sectionFields.length}</span>

                  {!isRenaming && (
                    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950 text-neutral-400 dark:text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400"
                        onClick={() => selectSectionFields(section.id)}
                        title="Select all fields in section"
                      >
                        <Crosshair className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500"
                        onClick={() => cycleSectionColor(section.id)}
                        title="Change color"
                      >
                        <div className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-600" style={{ backgroundColor: section.color }} />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500"
                        onClick={() => openSectionEdit(section.id)}
                        title="Edit section"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400"
                        onClick={() => deleteSection(section.id)}
                        title="Delete section"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Section fields */}
                {!isCollapsed && (
                  <div className="space-y-0.5 p-1">
                    {sectionFields.length === 0 && (
                      <p className="text-[10px] text-neutral-400 dark:text-neutral-500 text-center py-1.5">
                        No fields in this section on this page
                      </p>
                    )}
                    {sectionFields.map((f) => (
                      <FieldListItem
                        key={f.id}
                        field={f}
                        isSelected={f.id === selectedId}
                        isMultiSelected={multiSelectedIds.has(f.id)}
                        sectionColor={section.color}
                        onSelect={() => setSelectedId(f.id)}
                        onCtrlClick={() => setMultiSelectedIds((prev) => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped fields */}
          {(() => {
            const ungrouped = pageFields.filter((f) => !f.sectionId || !sections.some((s) => s.id === f.sectionId));
            if (ungrouped.length === 0 && sections.length > 0) return null;
            if (ungrouped.length === 0 && sections.length === 0) return null;
            return (
              <div className={sections.length > 0 ? "pt-1" : ""}>
                {sections.length > 0 && (
                  <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium px-1 pb-0.5">
                    Ungrouped ({ungrouped.length})
                  </div>
                )}
                <div className="space-y-0.5">
                  {ungrouped.map((f) => (
                    <FieldListItem
                      key={f.id}
                      field={f}
                      isSelected={f.id === selectedId}
                      isMultiSelected={multiSelectedIds.has(f.id)}
                      onSelect={() => setSelectedId(f.id)}
                      onCtrlClick={() => setMultiSelectedIds((prev) => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                    />
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Section config dialog — pick which fields to include */}
      {sectionPickerTemplate && (() => {
        const tpl = sectionPickerTemplate;
        const checkedCount = tpl.fields.filter((f) => fieldSelections[f.fieldKey]?.checked).length;
        const defaultFields = tpl.fields.filter((f) => f.defaultOn);
        const extraFields = tpl.fields.filter((f) => !f.defaultOn);

        return (
          <Dialog open onOpenChange={(open) => { if (!open) { setSectionPickerTemplate(null); setEditingSectionId(null); } }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tpl.color }} />
                    {editingSectionId ? `Edit Section: ${tpl.name}` : `Add Section: ${tpl.name}`}
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => {
                        const s: Record<string, { checked: boolean; showLabel: boolean }> = {};
                        tpl.fields.forEach((f) => { s[f.fieldKey] = { ...fieldSelections[f.fieldKey], checked: true }; });
                        setFieldSelections(s);
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => {
                        const s: Record<string, { checked: boolean; showLabel: boolean }> = {};
                        tpl.fields.forEach((f) => { s[f.fieldKey] = { ...fieldSelections[f.fieldKey], checked: false }; });
                        setFieldSelections(s);
                      }}
                    >
                      Deselect All
                    </button>
                  </div>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{checkedCount} / {tpl.fields.length} selected</span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-neutral-600 dark:text-neutral-400">Label color</label>
                    <input
                      type="color"
                      value={sectionLabelColor}
                      onChange={(e) => setSectionLabelColor(e.target.value)}
                      className="h-6 w-7 rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                    />
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">{sectionLabelColor}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-neutral-600 dark:text-neutral-400">Data color</label>
                    <input
                      type="color"
                      value={sectionDataColor}
                      onChange={(e) => setSectionDataColor(e.target.value)}
                      className="h-6 w-7 rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                    />
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">{sectionDataColor}</span>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto border rounded-md border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
                  {defaultFields.map((f) => {
                    const sel = fieldSelections[f.fieldKey];
                    return (
                      <div key={f.fieldKey} className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                        <input
                          type="checkbox"
                          id={`sec-chk-${f.fieldKey}`}
                          checked={sel?.checked ?? false}
                          onChange={() => toggleFieldSel(f.fieldKey, "checked")}
                          className="rounded border-neutral-300 dark:border-neutral-600 h-3.5 w-3.5 cursor-pointer"
                        />
                        <label htmlFor={`sec-chk-${f.fieldKey}`} className="flex-1 text-sm text-neutral-800 dark:text-neutral-200 cursor-pointer select-none">
                          {f.label}
                        </label>
                        <label className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-500 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={sel?.showLabel ?? false}
                            onChange={() => toggleFieldSel(f.fieldKey, "showLabel")}
                            className="rounded border-neutral-300 dark:border-neutral-600 h-3 w-3"
                          />
                          Label
                        </label>
                      </div>
                    );
                  })}

                  {extraFields.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 bg-neutral-50 dark:bg-neutral-900 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">
                        More fields
                      </div>
                      {extraFields.map((f) => {
                        const sel = fieldSelections[f.fieldKey];
                        return (
                          <div key={f.fieldKey} className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                            <input
                              type="checkbox"
                              id={`sec-chk-${f.fieldKey}`}
                              checked={sel?.checked ?? false}
                              onChange={() => toggleFieldSel(f.fieldKey, "checked")}
                              className="rounded border-neutral-300 dark:border-neutral-600 h-3.5 w-3.5 cursor-pointer"
                            />
                            <label htmlFor={`sec-chk-${f.fieldKey}`} className="flex-1 text-sm text-neutral-800 dark:text-neutral-200 cursor-pointer select-none">
                              {f.label}
                            </label>
                            <label className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-500 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={sel?.showLabel ?? false}
                                onChange={() => toggleFieldSel(f.fieldKey, "showLabel")}
                                className="rounded border-neutral-300 dark:border-neutral-600 h-3 w-3"
                              />
                              Label
                            </label>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
                  Check &quot;Label&quot; to also add a static text label next to the value field on the PDF.
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setSectionPickerTemplate(null); setEditingSectionId(null); }}>Cancel</Button>
                <Button onClick={confirmSectionAdd} disabled={checkedCount === 0}>
                  {editingSectionId ? `Update Section (${checkedCount})` : `Add ${checkedCount} Field${checkedCount !== 1 ? "s" : ""} to PDF`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

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
            <div className="flex gap-1">
              <Button
                size="xs"
                variant="outline"
                className="gap-1 text-xs flex-1"
                onClick={addAnotherField}
              >
                <Plus className="h-3 w-3" /> New
              </Button>
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

            {sections.length > 0 && (
              <div>
                <Label className="text-xs">Section</Label>
                <select
                  value={selectedField.sectionId ?? ""}
                  onChange={(e) =>
                    updateField(selectedField.id, {
                      sectionId: e.target.value || undefined,
                    })
                  }
                  className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
                >
                  <option value="">Ungrouped</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

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
