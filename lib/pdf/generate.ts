import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type {
  PdfFieldMapping, PdfPageInfo, PdfImageMapping, PdfDrawing,
  PdfCheckbox, PdfRadioGroup, PdfTextInput,
} from "@/lib/types/pdf-template";
import { resolveFieldValue, type MergeContext } from "./resolve-data";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function drawVectorGlyph(
  page: ReturnType<PDFDocument["getPages"]>[number],
  glyph: string,
  x: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
  opacity: number = 1,
) {
  // Stroke width = ~28% of glyph size with a 2.2pt floor. Anything
  // thinner reads as a hairline and the color washes out at the
  // typical 7-12pt checkbox sizes used in insurance forms.
  const strokeWidth = Math.max(2.2, size * 0.28);
  if (glyph === "✓" || glyph === "✔") {
    page.drawLine({
      start: { x: x + size * 0.12, y: y + size * 0.38 },
      end: { x: x + size * 0.38, y: y + size * 0.12 },
      thickness: strokeWidth,
      color,
      opacity,
    });
    page.drawLine({
      start: { x: x + size * 0.38, y: y + size * 0.12 },
      end: { x: x + size * 0.88, y: y + size * 0.82 },
      thickness: strokeWidth,
      color,
      opacity,
    });
    return true;
  }

  if (glyph === "✗" || glyph === "✕" || glyph === "×") {
    page.drawLine({
      start: { x: x + size * 0.16, y: y + size * 0.16 },
      end: { x: x + size * 0.84, y: y + size * 0.84 },
      thickness: strokeWidth,
      color,
      opacity,
    });
    page.drawLine({
      start: { x: x + size * 0.84, y: y + size * 0.16 },
      end: { x: x + size * 0.16, y: y + size * 0.84 },
      thickness: strokeWidth,
      color,
      opacity,
    });
    return true;
  }

  if (glyph === "●" || glyph === "○") {
    page.drawEllipse({
      x: x + size * 0.5,
      y: y + size * 0.48,
      xScale: size * 0.34,
      yScale: size * 0.34,
      borderColor: color,
      borderWidth: strokeWidth,
      color: glyph === "●" ? color : undefined,
      opacity: glyph === "●" ? opacity : undefined,
      borderOpacity: opacity,
    });
    return true;
  }

  return false;
}

/**
 * Opacity for the SELECTED mark (✓ tick or ● dot). This is the
 * actual answer the user picked, so it should read clearly. 0.95
 * is essentially solid with just a hint of softness.
 */
const MARK_OPACITY = 0.95;

/**
 * Opacity for the NON-SELECTED markup — the box outline drawn
 * around every configured checkbox / radio option to show "this
 * is a fillable spot" even when nothing is ticked. The user
 * called this the "markup of the non-selected status" and wants
 * it soft (50% transparent) so it doesn't compete with the
 * printed form.
 */
const OUTLINE_OPACITY = 0.5;

/**
 * Ink color for ✓ checkmarks (used for both checkboxes and radio
 * selections). A deep blue reads
 * unmistakably as "the user filled this in" — distinct from the
 * black printed form text and far more visible than gray.
 */
const MARKUP_COLOR = rgb(0.05, 0.2, 0.7);

export async function generateFilledPdf(
  templateBytes: Buffer | Uint8Array,
  fields: PdfFieldMapping[],
  ctx: MergeContext,
  opts?: {
    pages?: PdfPageInfo[];
    images?: PdfImageMapping[];
    drawings?: PdfDrawing[];
    checkboxes?: PdfCheckbox[];
    radioGroups?: PdfRadioGroup[];
    /**
     * Fillable AcroForm text inputs the recipient can type into. Each
     * becomes a real `pdf-lib` TextField widget so any standard PDF
     * viewer (Adobe, Edge, Chrome, in-app preview) can fill them in.
     * Flattened along with checkboxes / radios when `opts.flatten` is true.
     */
    textInputs?: PdfTextInput[];
    /**
     * Per-text-input runtime override keyed by `PdfTextInput.id`.
     * When provided, takes precedence over `ti.defaultValue`.
     * Used by the preview dialog so users can pre-fill values before
     * downloading or emailing.
     */
    textInputOverrides?: Record<string, string>;
    /**
     * Per-checkbox runtime override keyed by `PdfCheckbox.id`.
     * When provided, takes precedence over `cb.defaultChecked`.
     * Used by the preview dialog so users can tick boxes before
     * downloading or emailing.
     */
    checkboxOverrides?: Record<string, boolean>;
    /**
     * Per-radio-group runtime override keyed by `PdfRadioGroup.id`.
     * Value is the chosen `PdfRadioOption.value`. Takes precedence
     * over `rg.defaultValue`. Pass an empty string to explicitly
     * unset the group.
     */
    radioOverrides?: Record<string, string>;
    loadImage?: (storedName: string) => Promise<Buffer>;
    /**
     * When true, all AcroForm widgets (checkboxes, radio buttons) are
     * flattened into static page content before saving. The visual result
     * is identical but the fields are no longer editable in any PDF viewer.
     * Use this when attaching to outgoing emails so recipients receive a
     * clean, tamper-proof record.
     */
    flatten?: boolean;
  },
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  const existingPageCount = pdfDoc.getPages().length;
  const pageDefs = opts?.pages ?? [];
  for (let i = existingPageCount; i < pageDefs.length; i++) {
    const pg = pageDefs[i];
    pdfDoc.addPage([pg.width, pg.height]);
  }

  const pages = pdfDoc.getPages();

  if (opts?.drawings?.length) {
    for (const d of opts.drawings) {
      if (d.page < 0 || d.page >= pages.length) continue;
      const color = d.strokeColor ? hexToRgb(d.strokeColor) : rgb(0, 0, 0);
      pages[d.page].drawRectangle({
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        borderColor: color,
        borderWidth: d.strokeWidth ?? 0.75,
      });
    }
  }

  if (opts?.images?.length && opts.loadImage) {
    for (const img of opts.images) {
      if (img.page < 0 || img.page >= pages.length) continue;
      try {
        const imgBytes = await opts.loadImage(img.storedName);
        let embedded;
        const isPng =
          imgBytes[0] === 0x89 && imgBytes[1] === 0x50 && imgBytes[2] === 0x4e && imgBytes[3] === 0x47;
        if (isPng) {
          embedded = await pdfDoc.embedPng(imgBytes);
        } else {
          embedded = await pdfDoc.embedJpg(imgBytes);
        }
        pages[img.page].drawImage(embedded, {
          x: img.x,
          y: img.y,
          width: img.width,
          height: img.height,
        });
      } catch (err) {
        console.error(`Failed to embed image ${img.storedName}:`, err);
      }
    }
  }

  for (const field of fields) {
    const pageIndex = field.page;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const text = resolveFieldValue(field, ctx);
    if (!text) continue;

    const fontSize = field.fontSize ?? 10;
    const color = field.fontColor ? hexToRgb(field.fontColor) : rgb(0, 0, 0);

    const font =
      field.bold && field.italic ? fontBoldItalic :
      field.bold ? fontBold :
      field.italic ? fontItalic :
      fontRegular;

    let x = field.x;
    const vectorGlyphWidth = fontSize;
    if (text.length <= 2 && ["✓", "✔", "✗", "✕", "×", "●", "○"].includes(text)) {
      if (field.align === "center" && field.width) {
        x = field.x + (field.width - vectorGlyphWidth) / 2;
      } else if (field.align === "right" && field.width) {
        x = field.x + field.width - vectorGlyphWidth;
      }
      if (drawVectorGlyph(page, text, x, field.y, fontSize, color)) continue;
    }

    const textWidth = font.widthOfTextAtSize(text, fontSize);
    if (field.align === "center" && field.width) {
      x = field.x + (field.width - textWidth) / 2;
    } else if (field.align === "right" && field.width) {
      x = field.x + field.width - textWidth;
    }

    page.drawText(text, {
      x,
      y: field.y,
      size: fontSize,
      font,
      color,
      maxWidth: field.width,
    });

    if (field.underline) {
      const lineWidth = field.width ? Math.min(textWidth, field.width) : textWidth;
      page.drawLine({
        start: { x, y: field.y - 1.5 },
        end: { x: x + lineWidth, y: field.y - 1.5 },
        thickness: Math.max(fontSize * 0.06, 0.5),
        color,
      });
    }
  }

  // Checkbox / radio rendering — split into two visual layers:
  //
  //  1. The OUTLINE (non-selected markup) — a soft, semi-transparent
  //     gray rectangle that just says "a fillable box lives here".
  //     Skipped when the admin marked the field `borderless` (because
  //     the underlying printed PDF already shows the box).
  //
  //  2. The MARK (✓) — drawn ONLY when the option is selected.
  //     Bold blue at near-full opacity so the user's answer reads
  //     instantly. Used for both checkboxes and radio selections so
  //     the visual language is consistent across the form.
  //
  // We don't create AcroForm widgets — the side-panel is the source
  // of truth and the recipient receives a finalized, printed-style
  // PDF rather than an editable form.
  //
  // Selected boxes get NO outline, NO tint, NO border — just the
  // bold ✓ mark itself. The user's chosen answer is the only thing
  // in the printed form, exactly like a real signed paper form.

  if (opts?.checkboxes?.length) {
    for (const cb of opts.checkboxes) {
      if (cb.page < 0 || cb.page >= pages.length) continue;
      const page = pages[cb.page];

      const cbOverride = opts.checkboxOverrides?.[cb.id];
      const isChecked = typeof cbOverride === "boolean" ? cbOverride : !!cb.defaultChecked;

      if (isChecked) {
        const size = Math.min(cb.width, cb.height);
        const cx = cb.x + (cb.width - size) / 2;
        const cy = cb.y + (cb.height - size) / 2;
        drawVectorGlyph(page, "✓", cx, cy, size, MARKUP_COLOR, MARK_OPACITY);
      } else if (!opts?.flatten) {
        // Non-selected = the "markup". A soft blue tint FILL (no
        // border at all) showing "this spot is fillable". Skipped
        // in flat/email mode — the client copy should look like a
        // clean signed form with no editor helper tints.
        page.drawRectangle({
          x: cb.x,
          y: cb.y,
          width: cb.width,
          height: cb.height,
          color: MARKUP_COLOR,
          opacity: OUTLINE_OPACITY,
          borderWidth: 0,
        });
      }
    }
  }

  if (opts?.radioGroups?.length) {
    for (const rg of opts.radioGroups) {
      if (!rg.options?.length) continue;

      const rgOverride = opts.radioOverrides?.[rg.id];
      const chosen = rgOverride !== undefined ? rgOverride : rg.defaultValue;

      for (const opt of rg.options) {
        if (opt.page < 0 || opt.page >= pages.length) continue;
        const page = pages[opt.page];

        const isChosen = !!chosen && opt.value === chosen;

        if (isChosen) {
          const size = Math.min(opt.width, opt.height);
          const cx = opt.x + (opt.width - size) / 2;
          const cy = opt.y + (opt.height - size) / 2;
          drawVectorGlyph(page, "✓", cx, cy, size, MARKUP_COLOR, MARK_OPACITY);
        } else if (!opts?.flatten) {
          // Same rationale as checkboxes — soft blue tint fill, no
          // border. Skipped in flat/email mode for the same reason.
          page.drawRectangle({
            x: opt.x,
            y: opt.y,
            width: opt.width,
            height: opt.height,
            color: MARKUP_COLOR,
            opacity: OUTLINE_OPACITY,
            borderWidth: 0,
          });
        }
      }
    }
  }

  // Fillable AcroForm text inputs — for blanks the policy data can't
  // fill (e.g. driver rows the recipient must enter manually for a
  // company-insured policy, additional remarks, hand-written sign-off
  // dates). Each becomes a real PDF TextField widget readable by any
  // standard viewer.
  //
  // Field name format: `ti_${input.id}` — uses the input's UUID so it
  // stays unique per template across renders. Pre-filled with
  // `defaultValue` (or runtime `textInputOverrides[id]`); recipient can
  // overwrite. Flattened along with other widgets when `opts.flatten`
  // is true so the email copy can't be tampered with.
  if (opts?.textInputs?.length) {
    const form = pdfDoc.getForm();
    const usedNames = new Set<string>();
    for (const ti of opts.textInputs) {
      if (ti.page < 0 || ti.page >= pages.length) continue;
      const page = pages[ti.page];

      const override = opts.textInputOverrides?.[ti.id];
      const initialValue =
        override !== undefined ? override : (ti.defaultValue ?? "");

      // Flat / email mode: skip the AcroForm widget entirely and
      // draw the value (if any) as plain text on the page. Avoids
      // pdf-lib's default 1pt border that gets baked into the
      // appearance stream during `form.flatten()` even with
      // `borderWidth: 0` — leaving an outlined box around every
      // input on the recipient's PDF. With this, a flat input with
      // no value is completely invisible (just a blank spot on the
      // form), and an input with a value renders as plain text.
      if (opts?.flatten) {
        if (initialValue) {
          const fontSize = ti.fontSize ?? 10;
          // Vertically centre single-line text inside the box;
          // multiline starts from the top so wrapped lines flow
          // downward like a normal paragraph.
          const textY = ti.multiline
            ? ti.y + ti.height - fontSize - 2
            : ti.y + Math.max(2, (ti.height - fontSize) / 2);
          page.drawText(String(initialValue), {
            x: ti.x + 2,
            y: textY,
            size: fontSize,
            font: fontRegular,
            color: rgb(0, 0, 0),
            maxWidth: ti.multiline ? Math.max(0, ti.width - 4) : undefined,
            lineHeight: ti.multiline ? fontSize * 1.2 : undefined,
          });
        }
        continue;
      }

      // Interactive mode: create a real AcroForm TextField the
      // recipient can type into.
      let fieldName = `ti_${ti.id}`;
      let suffix = 1;
      while (usedNames.has(fieldName)) {
        fieldName = `ti_${ti.id}_${suffix++}`;
      }
      usedNames.add(fieldName);

      const tf = form.createTextField(fieldName);
      if (initialValue) tf.setText(initialValue);
      if (ti.multiline) tf.enableMultiline();

      tf.addToPage(page, {
        x: ti.x,
        y: ti.y,
        width: ti.width,
        height: ti.height,
        borderWidth: 0,
        backgroundColor: rgb(0.9, 0.95, 1),
      });

      if (typeof ti.fontSize === "number" && ti.fontSize > 0) {
        try { tf.setFontSize(ti.fontSize); } catch { /* pdf-lib may reject zero */ }
      }
    }
  }

  if (opts?.flatten) {
    pdfDoc.getForm().flatten();
  }

  return pdfDoc.save();
}
