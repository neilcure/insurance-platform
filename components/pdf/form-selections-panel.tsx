"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PdfCheckbox, PdfRadioGroup, PdfTemplateMeta, PdfTextInput } from "@/lib/types/pdf-template";
import {
  PDF_SELECTION_MARK_STORAGE_KEY,
  PDF_SELECTION_MARK_SCALE_KEY,
  type PdfSelectionMarkStyle,
  readPdfSelectionMarkFromStorage,
  readPdfSelectionMarkScaleFromStorage,
  normalizePdfSelectionMarkScale,
} from "@/lib/pdf/form-selections-preferences";
import { emitPdfSelectionMarkChanged } from "@/lib/pdf/form-selections-mark-prefs-client";

export function radioOptionMatchesSelection(selected: string | undefined, optionValue: string): boolean {
  if (selected === undefined || selected === null || selected === "") return false;
  return String(selected).trim().toLowerCase() === String(optionValue).trim().toLowerCase();
}

function radioGroupPageInfo(rg: PdfRadioGroup): { sortKey: number; display: string } {
  if (!rg.options || rg.options.length === 0) {
    return { sortKey: Number.MAX_SAFE_INTEGER, display: "" };
  }
  const pages = rg.options.map((o) => o.page);
  const min = Math.min(...pages);
  const max = Math.max(...pages);
  const display = min === max ? String(min + 1) : `${min + 1}–${max + 1}`;
  return { sortKey: min, display };
}

function sortCheckboxes(raw: PdfCheckbox[]): PdfCheckbox[] {
  return [...raw].sort((a, b) => (a.page !== b.page ? a.page - b.page : raw.indexOf(a) - raw.indexOf(b)));
}

function sortRadioGroups(raw: PdfRadioGroup[]): PdfRadioGroup[] {
  return [...raw].sort((a, b) => {
    const ak = radioGroupPageInfo(a).sortKey;
    const bk = radioGroupPageInfo(b).sortKey;
    if (ak !== bk) return ak - bk;
    return raw.indexOf(a) - raw.indexOf(b);
  });
}

function usePdfSelectionMark(onChange?: () => void): [PdfSelectionMarkStyle, (s: PdfSelectionMarkStyle) => void] {
  const [mark, setMarkState] = React.useState<PdfSelectionMarkStyle>(() =>
    typeof window !== "undefined" ? readPdfSelectionMarkFromStorage() : "check",
  );
  React.useEffect(() => {
    setMarkState(readPdfSelectionMarkFromStorage());
  }, []);
  const setMark = React.useCallback(
    (s: PdfSelectionMarkStyle) => {
      setMarkState(s);
      try {
        localStorage.setItem(PDF_SELECTION_MARK_STORAGE_KEY, s);
      } catch {
        /* ignore */
      }
      emitPdfSelectionMarkChanged();
      onChange?.();
    },
    [onChange],
  );
  return [mark, setMark];
}

function usePdfMarkScale(onChange?: () => void): [number, (n: number) => void] {
  const [scale, setScaleState] = React.useState<number>(() =>
    typeof window !== "undefined" ? readPdfSelectionMarkScaleFromStorage() : 1,
  );
  React.useEffect(() => {
    setScaleState(readPdfSelectionMarkScaleFromStorage());
  }, []);
  const setScale = React.useCallback(
    (n: number) => {
      const v = normalizePdfSelectionMarkScale(n);
      setScaleState(v);
      try {
        localStorage.setItem(PDF_SELECTION_MARK_SCALE_KEY, String(v));
      } catch {
        /* ignore */
      }
      emitPdfSelectionMarkChanged();
      onChange?.();
    },
    [onChange],
  );
  return [scale, setScale];
}

const MARK_SIZE_PRESETS = [
  { label: "S", value: 0.75 },
  { label: "M", value: 1 },
  { label: "L", value: 1.25 },
] as const;

export type FormSelectionsPanelProps = {
  checkboxes: PdfCheckbox[];
  radioGroups: PdfRadioGroup[];
  textInputs?: PdfTextInput[];
  /** Resolved checked state per checkbox (preview: overrides; template: defaultChecked) */
  getCheckboxChecked: (cb: PdfCheckbox) => boolean;
  /** Resolved selected value per radio group (string, may be "") */
  getRadioCurrent: (rg: PdfRadioGroup) => string;
  onToggleCheckbox: (cbId: string, templateDefaultChecked: boolean) => void;
  onSetRadio: (rgId: string, value: string) => void;
  onClearRadio: (rgId: string) => void;
  getTextInputValue?: (input: PdfTextInput) => string;
  onSetTextInput?: (inputId: string, value: string) => void;
  /** preview: reset overrides */
  onResetAll?: () => void;
  /** Show Reset when preview overrides are non-empty */
  resetVisible?: boolean;
  refreshing?: boolean;
  /**
   * preview: explicit "Save now" — flushes any pending auto-save
   * debounce immediately and shows a toast on success / failure.
   * Hidden when not provided (e.g. in the admin template editor).
   */
  onSaveNow?: () => void | Promise<void>;
  /**
   * Drives the save status pill next to the Save button:
   *   - "saved": all changes persisted (green, no button needed)
   *   - "dirty": user made changes that haven't reached the server yet
   *   - "saving": PUT in flight
   */
  saveStatus?: "saved" | "dirty" | "saving";
  /** Admin can rename labels */
  canRenameLabels: boolean;
  /**
   * Persist label text. Preview mode: PATCH template. Template mode: update local state.
   */
  onSaveLabel: (kind: "cb" | "rg", id: string, label: string) => Promise<void>;
  /** Optional: click question title (template editor jumps to PDF) */
  onRadioTitleClick?: (rg: PdfRadioGroup) => void;
  onCheckboxTitleClick?: (cb: PdfCheckbox) => void;
  /** Intro copy (template editor help text) */
  intro?: React.ReactNode;
  emptyMessage?: string;
  /** preview = blue filled buttons; template = violet */
  accent: "blue" | "violet";
  /**
   * When the user switches ✓ vs ✗ for marks drawn on the merged PDF,
   * re-fetch preview (policy preview only; optional elsewhere).
   */
  onPdfSelectionMarkChange?: () => void;
  /**
   * dialog-side = full aside with title row (policy PDF preview).
   * drawer-body = scroll body only (template editor SlideDrawer already has a title).
   */
  shell: "dialog-side" | "drawer-body";
  className?: string;
};

export function FormSelectionsPanel({
  checkboxes: checkboxesIn,
  radioGroups: radioGroupsIn,
  textInputs: textInputsIn = [],
  getCheckboxChecked,
  getRadioCurrent,
  onToggleCheckbox,
  onSetRadio,
  onClearRadio,
  getTextInputValue,
  onSetTextInput,
  onResetAll,
  resetVisible = false,
  refreshing,
  onSaveNow,
  saveStatus,
  canRenameLabels,
  onSaveLabel,
  onRadioTitleClick,
  onCheckboxTitleClick,
  intro,
  emptyMessage = "No form fields on this template.",
  accent,
  onPdfSelectionMarkChange,
  shell,
  className,
}: FormSelectionsPanelProps) {
  const checkboxes = React.useMemo(() => sortCheckboxes(checkboxesIn), [checkboxesIn]);
  const radioGroups = React.useMemo(() => sortRadioGroups(radioGroupsIn), [radioGroupsIn]);
  const textInputs = React.useMemo(
    () => [...textInputsIn].sort((a, b) => (a.page !== b.page ? a.page - b.page : textInputsIn.indexOf(a) - textInputsIn.indexOf(b))),
    [textInputsIn],
  );
  const [pdfMarkStyle, setPdfMarkStyle] = usePdfSelectionMark(onPdfSelectionMarkChange);
  const [pdfMarkScale, setPdfMarkScale] = usePdfMarkScale(onPdfSelectionMarkChange);

  const [editing, setEditing] = React.useState<{ kind: "cb" | "rg"; id: string } | null>(null);
  const [editText, setEditText] = React.useState("");
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const editInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) editInputRef.current?.focus();
  }, [editing]);

  function startEdit(kind: "cb" | "rg", id: string, currentLabel: string) {
    setEditing({ kind, id });
    setEditText(currentLabel);
  }

  function cancelEdit() {
    setEditing(null);
    setEditText("");
  }

  async function commitSave() {
    if (!editing) return;
    const trimmed = editText.trim();
    setSavingId(editing.id);
    try {
      await onSaveLabel(editing.kind, editing.id, trimmed);
      setEditing(null);
      setEditText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save label");
    } finally {
      setSavingId(null);
    }
  }

  const activeBtn =
    accent === "blue"
      ? "border-blue-500 bg-blue-500 text-white dark:bg-blue-600"
      : "border-violet-500 bg-violet-600 text-white dark:bg-violet-600";
  const inactiveBtn =
    "border-neutral-300 bg-white hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700";

  function renderRadioOptions(rg: PdfRadioGroup) {
    const current = getRadioCurrent(rg);
    return (
      <div className="flex flex-wrap gap-1">
        {rg.options.map((opt) => {
          const active = radioOptionMatchesSelection(current, opt.value);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSetRadio(rg.id, opt.value)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                active ? activeBtn : inactiveBtn,
              )}
            >
              {opt.label?.trim() || opt.value}
            </button>
          );
        })}
        {current !== "" && (
          <button
            type="button"
            onClick={() => onClearRadio(rg.id)}
            className="rounded-md border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Clear
          </button>
        )}
      </div>
    );
  }

  const preferencesHeader = (
    <div className="space-y-2 border-b border-neutral-200 dark:border-neutral-800 pb-2 mb-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-neutral-500 dark:text-neutral-400">Mark on PDF</span>
        <div className="flex rounded-md border border-neutral-200 dark:border-neutral-800 p-0.5 bg-neutral-50 dark:bg-neutral-900/80">
          <button
            type="button"
            onClick={() => setPdfMarkStyle("check")}
            title="Draw a tick (✓) for each selected box or option in the generated PDF"
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium",
              pdfMarkStyle === "check"
                ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400",
            )}
          >
            ✓ Tick
          </button>
          <button
            type="button"
            onClick={() => setPdfMarkStyle("cross")}
            title="Draw a cross (✗) for each selected box or option in the generated PDF"
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium",
              pdfMarkStyle === "cross"
                ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400",
            )}
          >
            ✗ Cross
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-neutral-500 dark:text-neutral-400">Mark size</span>
        <div className="flex rounded-md border border-neutral-200 dark:border-neutral-800 p-0.5 bg-neutral-50 dark:bg-neutral-900/80">
          {MARK_SIZE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPdfMarkScale(p.value)}
              title={`Scale marks to ${Math.round(p.value * 100)}% of each box on the PDF`}
              className={cn(
                "min-w-7 rounded px-2 py-0.5 text-[10px] font-medium",
                Math.abs(pdfMarkScale - p.value) < 0.02
                  ? "bg-white dark:bg-neutral-800 shadow-sm text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 dark:text-neutral-400",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const scrollBody = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 space-y-3 text-xs">
      {preferencesHeader}
      {intro}
      {radioGroups.length === 0 && checkboxes.length === 0 && textInputs.length === 0 && (
        <div className="text-neutral-500 dark:text-neutral-400 italic">{emptyMessage}</div>
      )}

      {radioGroups.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Yes / No questions
          </h4>
          <ul className="space-y-2">
            {radioGroups.map((rg, idx) => {
              const fallback = `Question ${idx + 1}`;
              const label = rg.label?.trim() || rg.name?.trim() || fallback;
              const pageInfo = radioGroupPageInfo(rg);
              const isEditing = editing?.kind === "rg" && editing.id === rg.id;
              const isSaving = savingId === rg.id;
              return (
                <li
                  key={rg.id}
                  className="relative rounded-md border border-neutral-200 dark:border-neutral-800 p-2 pr-10 bg-neutral-50 dark:bg-neutral-900/50"
                >
                  <div className="flex items-start gap-1 mb-1.5">
                    {isEditing ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                          ref={editInputRef}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitSave();
                            else if (e.key === "Escape") cancelEdit();
                          }}
                          placeholder={fallback}
                          disabled={isSaving}
                          className="h-6 text-[11px] px-1.5 dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700"
                        />
                        <button
                          type="button"
                          onClick={() => void commitSave()}
                          disabled={isSaving}
                          title="Save label"
                          className="shrink-0 rounded p-0.5 text-green-600 hover:bg-green-100 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/40"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSaving}
                          title="Cancel"
                          className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-800"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        {onRadioTitleClick ? (
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left font-medium leading-snug text-neutral-700 dark:text-neutral-200"
                            onClick={() => onRadioTitleClick(rg)}
                          >
                            {label}
                          </button>
                        ) : (
                          <div className="min-w-0 flex-1 font-medium leading-snug text-neutral-700 dark:text-neutral-200">{label}</div>
                        )}
                        {canRenameLabels && (
                          <button
                            type="button"
                            onClick={() => startEdit("rg", rg.id, rg.label?.trim() ?? "")}
                            title="Rename label"
                            className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {renderRadioOptions(rg)}
                  {pageInfo.display ? (
                    <span
                      className="absolute bottom-1.5 right-1.5 rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                      title={`On page ${pageInfo.display}`}
                    >
                      p.{pageInfo.display}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {checkboxes.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Checkboxes</h4>
          <ul className="space-y-1">
            {checkboxes.map((cb, idx) => {
              const checked = getCheckboxChecked(cb);
              const fallback = `Box ${idx + 1}`;
              const label = cb.label?.trim() || fallback;
              const isEditing = editing?.kind === "cb" && editing.id === cb.id;
              const isSaving = savingId === cb.id;
              return (
                <li
                  key={cb.id}
                  className="relative rounded-md p-1.5 pr-10 hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleCheckbox(cb.id, !!cb.defaultChecked)}
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer",
                        accent === "blue" ? "accent-blue-600" : "accent-emerald-600",
                      )}
                      disabled={isEditing}
                    />
                    {isEditing ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                          ref={editInputRef}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitSave();
                            else if (e.key === "Escape") cancelEdit();
                          }}
                          placeholder={fallback}
                          disabled={isSaving}
                          className="h-6 text-[11px] px-1.5 dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700"
                        />
                        <button
                          type="button"
                          onClick={() => void commitSave()}
                          disabled={isSaving}
                          title="Save label"
                          className="shrink-0 rounded p-0.5 text-green-600 hover:bg-green-100 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/40"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSaving}
                          title="Cancel"
                          className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-800"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        {onCheckboxTitleClick ? (
                          <button
                            type="button"
                            className="min-w-0 flex-1 cursor-pointer text-left leading-snug text-neutral-700 dark:text-neutral-200"
                            onClick={() => onCheckboxTitleClick(cb)}
                          >
                            {label}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="min-w-0 flex-1 cursor-pointer text-left leading-snug text-neutral-700 dark:text-neutral-200"
                            onClick={() => onToggleCheckbox(cb.id, !!cb.defaultChecked)}
                          >
                            {label}
                          </button>
                        )}
                        {canRenameLabels && (
                          <button
                            type="button"
                            onClick={() => startEdit("cb", cb.id, cb.label?.trim() ?? "")}
                            title="Rename label"
                            className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <span
                    className="pointer-events-none absolute bottom-1 right-1.5 rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    title={`On page ${cb.page + 1}`}
                  >
                    p.{cb.page + 1}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {textInputs.length > 0 && getTextInputValue && onSetTextInput && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Input fields</h4>
          <ul className="space-y-2">
            {textInputs.map((ti, idx) => {
              const fallback = `Input ${idx + 1}`;
              const label = ti.label?.trim() || ti.placeholder?.trim() || fallback;
              const value = getTextInputValue(ti);
              const pageLabel = `p.${ti.page + 1}`;
              return (
                <li
                  key={ti.id}
                  className="relative rounded-md border border-neutral-200 bg-neutral-50 p-2 pr-10 dark:border-neutral-800 dark:bg-neutral-900/50"
                >
                  <label className="mb-1 block text-[11px] font-medium leading-snug text-neutral-700 dark:text-neutral-200">
                    {label}
                  </label>
                  {ti.multiline ? (
                    <textarea
                      value={value}
                      onChange={(e) => onSetTextInput(ti.id, e.target.value)}
                      placeholder={ti.placeholder || ti.defaultValue || ""}
                      className="min-h-16 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                    />
                  ) : (
                    <Input
                      value={value}
                      onChange={(e) => onSetTextInput(ti.id, e.target.value)}
                      placeholder={ti.placeholder || ti.defaultValue || ""}
                      className="h-7 text-xs dark:bg-neutral-950 dark:text-neutral-100 dark:border-neutral-700"
                    />
                  )}
                  <span
                    className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    title={`On page ${ti.page + 1}`}
                  >
                    {pageLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );

  if (shell === "drawer-body") {
    return <div className={cn("flex h-full min-h-0 flex-col", className)}>{scrollBody}</div>;
  }

  return (
    <aside
      className={cn(
        "flex min-h-0 w-full min-w-0 shrink-0 flex-col border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 sm:w-72 sm:max-w-xs sm:border-b-0 sm:border-r",
        "max-h-[min(52dvh,28rem)] sm:max-h-none sm:flex-none",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Form selections</div>
          {/* Tiny save-state pill next to the title — same Google-Docs
              style "All saved / Saving… / Unsaved" pattern. Hidden in
              the admin template editor (no `saveStatus` passed). */}
          {saveStatus === "saving" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
          {saveStatus === "dirty" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
          {resetVisible && onResetAll && (
            <button
              type="button"
              onClick={onResetAll}
              className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              title="Clear your edits and revert to template defaults"
            >
              Reset
            </button>
          )}
          {onSaveNow && (
            <button
              type="button"
              onClick={() => void onSaveNow()}
              disabled={saveStatus !== "dirty"}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition",
                saveStatus === "dirty"
                  ? "border-blue-500 bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500"
                  : "border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-600",
              )}
              title={
                saveStatus === "dirty"
                  ? "Save your selections to this policy now"
                  : "All changes are already saved"
              }
            >
              {saveStatus === "saving" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Save
            </button>
          )}
        </div>
      </div>
      {scrollBody}
    </aside>
  );
}

/** Preview dialog: label save hits the template PATCH API */
export async function patchPdfTemplateFormLabels(
  tplId: number,
  meta: PdfTemplateMeta,
  kind: "cb" | "rg",
  id: string,
  label: string,
): Promise<PdfTemplateMeta> {
  const checkboxes = [...(meta.checkboxes ?? [])];
  const radioGroups = [...(meta.radioGroups ?? [])];
  const body: Record<string, unknown> = {};
  if (kind === "cb") {
    body.checkboxes = checkboxes.map((c) => (c.id === id ? { ...c, label } : c));
  } else {
    body.radioGroups = radioGroups.map((g) => (g.id === id ? { ...g, label } : g));
  }
  const res = await fetch(`/api/pdf-templates/${tplId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save label");
  }
  return {
    ...meta,
    ...(kind === "cb"
      ? { checkboxes: body.checkboxes as PdfTemplateMeta["checkboxes"] }
      : { radioGroups: body.radioGroups as PdfTemplateMeta["radioGroups"] }),
  };
}
