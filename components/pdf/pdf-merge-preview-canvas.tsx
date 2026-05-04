"use client";

/**
 * Read-only PDF preview used in the policy Documents → Mail Merge dialog.
 *
 * Renders the merged PDF (generated server-side ONCE on dialog open with
 * `skipSelectionMarks: true`) on a `react-pdf` canvas, then overlays
 * ✓/✗ marks for the **currently selected** checkboxes / radio options
 * via DOM. Clicking Yes/No / Tick/Cross / size in the side panel updates
 * React state only — no server roundtrip per click. Download / Send Email
 * still regenerate server-side with marks baked in.
 *
 * Coordinate model matches `PdfTemplateEditor`: PDF coords are bottom-up,
 * react-pdf renders top-down, so `screenY = (pageHeight - y - height) * scale`.
 */

import * as React from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Loader2 } from "lucide-react";
import type { PdfCheckbox, PdfPageInfo, PdfRadioGroup, PdfTextInput } from "@/lib/types/pdf-template";
import { radioOptionMatchesSelection } from "@/components/pdf/form-selections-panel";
import {
  usePdfSelectionMarkScaleSync,
  usePdfSelectionMarkSync,
} from "@/lib/pdf/form-selections-mark-prefs-client";

// Idempotent across remounts; same value the admin editor sets.
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

/**
 * pdf.js needs CMaps + standard-font data to decode CJK glyphs (Adobe-GB1 /
 * Adobe-CNS1 / Adobe-Japan1 / Adobe-Korea1) embedded in source PDFs. Without
 * these, every Chinese / Japanese / Korean character in the source renders
 * blank. Assets are provisioned to `public/pdfjs/` by
 * `scripts/copy-pdfjs-assets.mjs` (runs on postinstall / predev / prebuild).
 *
 * MUST be a module-scoped constant — react-pdf reloads the document whenever
 * `options` changes by reference.
 */
const PDF_DOC_OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
} as const;

type Props = {
  /** Object URL pointing at the merged PDF (skipSelectionMarks=true). */
  pdfUrl: string;
  /**
   * Natural PDF page dimensions in points, from `meta.pages`. Used to
   * compute the rendered-pixel ↔ PDF-point scale for the overlay. We
   * deliberately don't read these from `react-pdf`'s `onLoadSuccess`,
   * because in v10 that callback returns the **rendered** width/height
   * (i.e. equal to the `width` prop), which would collapse the scale
   * to 1 and place marks in the wrong spot.
   */
  pages: PdfPageInfo[];
  checkboxes: PdfCheckbox[];
  radioGroups: PdfRadioGroup[];
  textInputs?: PdfTextInput[];
  /** Resolved checked state per checkbox (overrides → defaultChecked). */
  getCheckboxChecked: (cb: PdfCheckbox) => boolean;
  /** Resolved selected value per radio group ("" if none). */
  getRadioCurrent: (rg: PdfRadioGroup) => string;
  getTextInputValue?: (input: PdfTextInput) => string;
  className?: string;
};

export function PdfMergePreviewCanvas({
  pdfUrl,
  pages,
  checkboxes,
  radioGroups,
  textInputs = [],
  getCheckboxChecked,
  getRadioCurrent,
  getTextInputValue,
  className,
}: Props) {
  const [numPages, setNumPages] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const markStyle = usePdfSelectionMarkSync();
  const markScale = usePdfSelectionMarkScaleSync();
  const markGlyph: "✓" | "✗" = markStyle === "cross" ? "✗" : "✓";

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Inset the rendered page slightly so it doesn't kiss the scroll edges.
  const renderWidth = Math.max(0, containerWidth - 24);

  return (
    <div
      ref={containerRef}
      className={`relative h-full overflow-y-auto bg-neutral-100 dark:bg-neutral-900 px-3 py-3 ${className ?? ""}`}
    >
      {pdfUrl ? (
        <Document
          file={pdfUrl}
          options={PDF_DOC_OPTIONS}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={
            <div className="flex h-32 items-center justify-center text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading…
            </div>
          }
          error={
            <div className="flex h-32 items-center justify-center text-sm text-red-500">
              Failed to load PDF preview.
            </div>
          }
        >
          {renderWidth > 0 &&
            Array.from({ length: numPages }, (_, i) => {
              // Natural PDF dims in points come from the template
              // metadata (the same source the admin editor uses).
              // Fall back to A4 portrait if a page is missing.
              const pageInfo = pages[i] ?? { width: 595, height: 842 };
              return (
                <PagePreview
                  key={i}
                  pageIndex={i}
                  renderWidth={renderWidth}
                  pdfWidth={pageInfo.width}
                  pdfHeight={pageInfo.height}
                  checkboxes={checkboxes.filter((c) => c.page === i)}
                  radioGroups={radioGroups}
                  textInputs={textInputs.filter((ti) => ti.page === i)}
                  getCheckboxChecked={getCheckboxChecked}
                  getRadioCurrent={getRadioCurrent}
                  getTextInputValue={getTextInputValue}
                  markGlyph={markGlyph}
                  markScale={markScale}
                />
              );
            })}
        </Document>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-neutral-500">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Generating preview…
        </div>
      )}
    </div>
  );
}

function PagePreview({
  pageIndex,
  renderWidth,
  pdfWidth,
  pdfHeight,
  checkboxes,
  radioGroups,
  textInputs,
  getCheckboxChecked,
  getRadioCurrent,
  getTextInputValue,
  markGlyph,
  markScale,
}: {
  pageIndex: number;
  renderWidth: number;
  pdfWidth: number;
  pdfHeight: number;
  checkboxes: PdfCheckbox[];
  radioGroups: PdfRadioGroup[];
  textInputs: PdfTextInput[];
  getCheckboxChecked: (cb: PdfCheckbox) => boolean;
  getRadioCurrent: (rg: PdfRadioGroup) => string;
  getTextInputValue?: (input: PdfTextInput) => string;
  markGlyph: "✓" | "✗";
  markScale: number;
}) {
  // Same coord model as `PdfTemplateEditor`:
  //   scale = rendered_px / pdf_points
  //   screenY = (pdfHeight - y - height) * scale  (PDF is bottom-up)
  const scale = pdfWidth > 0 ? renderWidth / pdfWidth : 0;

  return (
    <div className="relative mx-auto mb-3 bg-white shadow-md w-fit">
      <Page
        pageNumber={pageIndex + 1}
        width={renderWidth}
        renderTextLayer={false}
        // Annotation layer must be ON so AcroForm text-input widgets created
        // by `generateFilledPdf` (the fillable blanks the recipient types
        // into) are visible in the in-app preview. Without this, pdf.js
        // skips them entirely and the user sees an empty rectangle where
        // their input field should be — the field IS in the saved PDF, but
        // the in-app preview falsely suggests the export "lost" it.
        //
        // Safe in our pipeline because checkboxes / radios are NOT AcroForm
        // widgets in the generated PDF — they're drawn as plain rectangles
        // + vector glyphs, so the existing DOM overlay (above) for ✓/✗ and
        // tints continues to be the single source of truth for those.
        renderAnnotationLayer
        loading={
          <div className="flex h-32 items-center justify-center text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Page {pageIndex + 1}…
          </div>
        }
      />
      {scale > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {checkboxes.map((cb) => {
            if (!getCheckboxChecked(cb)) return null;
            const w = cb.width * scale;
            const h = cb.height * scale;
            return (
              <div
                key={cb.id}
                className="absolute flex items-center justify-center"
                style={{
                  left: cb.x * scale,
                  top: (pdfHeight - cb.y - cb.height) * scale,
                  width: w,
                  height: h,
                  fontSize: Math.max(8, Math.min(w, h) * 0.85 * markScale),
                  color: "#0a0a0a",
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {markGlyph}
              </div>
            );
          })}
          {radioGroups.flatMap((rg) => {
            const current = getRadioCurrent(rg);
            return rg.options
              .filter((o) => o.page === pageIndex)
              .filter((o) => radioOptionMatchesSelection(current, o.value))
              .map((o) => {
                const w = o.width * scale;
                const h = o.height * scale;
                return (
                  <div
                    key={`${rg.id}/${o.id}`}
                    className="absolute flex items-center justify-center"
                    style={{
                      left: o.x * scale,
                      top: (pdfHeight - o.y - o.height) * scale,
                      width: w,
                      height: h,
                      fontSize: Math.max(9, Math.min(w, h) * 0.62 * markScale),
                      color: "#0a0a0a",
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {markGlyph}
                  </div>
                );
              });
          })}
          {getTextInputValue
            ? textInputs.map((ti) => {
                const value = getTextInputValue(ti);
                if (!value) return null;
                return (
                  <div
                    key={ti.id}
                    className="absolute overflow-hidden whitespace-pre-wrap wrap-break-word text-neutral-950"
                    style={{
                      left: (ti.x + 2) * scale,
                      top: (pdfHeight - ti.y - ti.height + 2) * scale,
                      width: Math.max(0, ti.width - 4) * scale,
                      height: Math.max(0, ti.height - 4) * scale,
                      fontSize: (ti.fontSize ?? 10) * scale,
                      lineHeight: ti.multiline ? 1.2 : 1,
                    }}
                  >
                    {value}
                  </div>
                );
              })
            : null}
        </div>
      )}
    </div>
  );
}
