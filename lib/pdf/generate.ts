import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type {
  PdfFieldMapping, PdfPageInfo, PdfImageMapping, PdfDrawing,
  PdfCheckbox, PdfRadioGroup, PdfTextInput,
} from "@/lib/types/pdf-template";
import { resolveFieldValue, type MergeContext } from "./resolve-data";
import { normalizePdfSelectionMarkScale } from "./normalize-pdf-selection-mark-scale";
import { containsCjk, loadCjkFontBytes } from "./cjk-font";

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
 * Opacity for the SELECTED mark (✓ / ✗ tick or ● dot). This is the
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

/** Soft blue tint for non-selected preview helpers (fillable spots). */
const MARKUP_COLOR = rgb(0.05, 0.2, 0.7);

/** Ink for selected ✓ / ✗ marks — black to match typical signed paper forms. */
const SELECTION_MARK_INK = rgb(0, 0, 0);

/**
 * Greedy word-wrap that respects explicit newlines (`\n`) in the source
 * text. Each output line fits within `maxWidth` according to the given
 * font + size. Whitespace is collapsed within a paragraph the same way
 * a browser would render it, so admins don't have to hand-trim values.
 *
 * Falls back to a hard character-break for any single token that's too
 * long to fit on its own line (e.g. a 40-char URL inside a narrow
 * column) — without this guard a long unbreakable token would push past
 * `maxWidth` and ruin the layout.
 */
function wrapTextIntoLines(
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const out: string[] = [];
  const paragraphs = text.split(/\r?\n/);

  const measure = (s: string) => font.widthOfTextAtSize(s, fontSize);
  const breakLongToken = (token: string): string[] => {
    const chunks: string[] = [];
    let current = "";
    for (const ch of token) {
      const candidate = current + ch;
      if (measure(candidate) > maxWidth && current) {
        chunks.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  };

  for (const para of paragraphs) {
    if (para === "") {
      out.push("");
      continue;
    }
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const rawWord of words) {
      const tokens = measure(rawWord) > maxWidth ? breakLongToken(rawWord) : [rawWord];
      for (const word of tokens) {
        const candidate = line ? `${line} ${word}` : word;
        if (measure(candidate) > maxWidth && line) {
          out.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
    }
    out.push(line);
  }
  return out;
}

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
    /**
     * Vector mark drawn on the PDF for a **selected** checkbox or radio
     * option. Default `check` (✓). Some tenants prefer a cross (✗).
     */
    selectionMarkStyle?: "check" | "cross";
    /** Scale for ✓/✗ inside each widget box (default 1, clamped 0.55–1.35). */
    selectionMarkScale?: number;
    /**
     * When true, do NOT bake the selected ✓/✗ glyphs into the PDF.
     * Every checkbox / radio cell still gets the soft blue tint so
     * empty cells are visible. The client preview canvas overlays
     * marks via DOM so toggling Yes/No / Tick/Cross / size is instant
     * — no server roundtrip per click. Download / email always pass
     * `false` so recipients receive a fully baked PDF.
     */
    skipSelectionMarks?: boolean;
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
  const selectedMarkGlyph: "✓" | "✗" =
    opts?.selectionMarkStyle === "cross" ? "✗" : "✓";
  const selectionMarkScale = normalizePdfSelectionMarkScale(opts?.selectionMarkScale);

  const pdfDoc = await PDFDocument.load(templateBytes);
  // Required for embedding any non-StandardFont (i.e. our CJK font).
  // Cheap to register even when no CJK text shows up in this document.
  pdfDoc.registerFontkit(fontkit);

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  // CJK font is embedded LAZILY — only the first time a CJK string is
  // actually drawn. English-only PDFs (the common case) pay zero cost
  // and never hit the network. Subsequent CJK draws in the same PDF
  // reuse the same embedded subset.
  //
  // We cache the embedded PDFFont on the doc itself; once embedded we
  // can reuse for every CJK string in this PDF. `subset: true` means
  // pdf-lib only writes the actually-used glyphs into the output, so
  // a typical filled PDF gains ~30–80 KB instead of the full ~5 MB
  // font file.
  let cjkFontPromise: Promise<PDFFont> | null = null;
  let cjkFontWarned = false;
  const ensureCjkFont = async (): Promise<PDFFont | null> => {
    if (!cjkFontPromise) {
      cjkFontPromise = (async () => {
        const bytes = await loadCjkFontBytes();
        return pdfDoc.embedFont(bytes, { subset: true });
      })();
      cjkFontPromise.catch(() => {
        // Allow a future CJK string in *this same* PDF to retry —
        // and prevent the unhandled rejection from crashing the request.
        cjkFontPromise = null;
      });
    }
    try {
      return await cjkFontPromise;
    } catch (err) {
      if (!cjkFontWarned) {
        cjkFontWarned = true;
        console.error(
          "[pdf-generate] CJK font unavailable, Chinese characters will be omitted from this render:",
          err,
        );
      }
      return null;
    }
  };

  /**
   * Pick the right font for a piece of text. Latin-only text keeps
   * Helvetica (incl. bold/italic variants the admin configured); any
   * text containing CJK switches to the CJK font for the WHOLE string
   * — Noto Sans CJK has first-class Latin glyphs so mixed strings like
   * "Mr. 陳大文" still look natural. Bold/italic CJK falls back to
   * regular CJK because Noto Sans CJK ships no italic variant; this is
   * standard CJK typography (CJK scripts traditionally don't italicise).
   */
  const pickFont = async (
    text: string,
    bold: boolean | undefined,
    italic: boolean | undefined,
  ): Promise<PDFFont> => {
    if (containsCjk(text)) {
      const cjk = await ensureCjkFont();
      if (cjk) return cjk;
      // Fall through to Helvetica — drawText will throw on the CJK char,
      // but at least a localised error is preferable to silently
      // dropping non-CJK fields elsewhere in the same render.
    }
    if (bold && italic) return fontBoldItalic;
    if (bold) return fontBold;
    if (italic) return fontItalic;
    return fontRegular;
  };

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

    // pickFont automatically routes CJK text through the embedded
    // Noto Sans CJK font; pure-Latin text keeps the existing
    // Helvetica family with full bold/italic support.
    const font = await pickFont(text, field.bold, field.italic);

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

    // Effective wrap behaviour:
    //  - explicit `field.wrap === true`  → wrap (requires width)
    //  - explicit `field.wrap === false` → never wrap, even if width is set
    //  - `field.wrap === undefined` and `width` is set → wrap (legacy default,
    //     matches pre-toggle pdf-lib `maxWidth` auto-wrap so existing
    //     templates render the same after this feature shipped)
    //  - otherwise → single line, no maxWidth boundary
    const shouldWrap =
      field.wrap === true
        ? !!field.width
        : field.wrap === false
        ? false
        : !!field.width;

    if (shouldWrap && field.width) {
      const lines = wrapTextIntoLines(text, font, fontSize, field.width);
      // Match pdf-lib's default `drawText({ lineHeight })` so existing
      // templates that relied on the implicit auto-wrap render with the
      // same line spacing they did before this toggle existed. Falls
      // back to a 1.15× heuristic if the font doesn't expose a height
      // (StandardFonts always do, but be defensive).
      const lineHeight =
        typeof font.heightAtSize === "function"
          ? font.heightAtSize(fontSize)
          : fontSize * 1.15;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const lineWidth = font.widthOfTextAtSize(line, fontSize);
        let lineX = field.x;
        if (field.align === "center") {
          lineX = field.x + (field.width - lineWidth) / 2;
        } else if (field.align === "right") {
          lineX = field.x + field.width - lineWidth;
        }
        const lineY = field.y - i * lineHeight;
        page.drawText(line, {
          x: lineX,
          y: lineY,
          size: fontSize,
          font,
          color,
        });
        if (field.underline) {
          page.drawLine({
            start: { x: lineX, y: lineY - 1.5 },
            end: { x: lineX + lineWidth, y: lineY - 1.5 },
            thickness: Math.max(fontSize * 0.06, 0.5),
            color,
          });
        }
      }
      continue;
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
  //  2. The MARK (✓ or ✗ per `selectionMarkStyle`) — drawn ONLY when
  //     the option is selected. Black ink at near-full opacity. Same
  //     glyph for checkboxes and radios.
  //
  // We don't create AcroForm widgets — the side-panel is the source
  // of truth and the recipient receives a finalized, printed-style
  // PDF rather than an editable form.
  //
  // Selected boxes get NO outline, NO tint, NO border — just the
  // bold vector mark. The user's chosen answer is the only thing
  // in the printed form, exactly like a real signed paper form.

  if (opts?.checkboxes?.length) {
    for (const cb of opts.checkboxes) {
      if (cb.page < 0 || cb.page >= pages.length) continue;
      const page = pages[cb.page];

      const cbOverride = opts.checkboxOverrides?.[cb.id];
      const isChecked = typeof cbOverride === "boolean" ? cbOverride : !!cb.defaultChecked;

      if (isChecked && !opts?.skipSelectionMarks) {
        const size = Math.min(cb.width, cb.height);
        const glyphSize = size * selectionMarkScale;
        const cx = cb.x + (cb.width - glyphSize) / 2;
        const cy = cb.y + (cb.height - glyphSize) / 2;
        drawVectorGlyph(page, selectedMarkGlyph, cx, cy, glyphSize, SELECTION_MARK_INK, MARK_OPACITY);
      } else if (!opts?.flatten) {
        // Non-selected = the "markup". A soft blue tint FILL (no
        // border at all) showing "this spot is fillable". Skipped
        // in flat/email mode — the client copy should look like a
        // clean signed form with no editor helper tints.
        // When `skipSelectionMarks` is on, every cell (including
        // selected) gets the tint so the client overlay has a frame.
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

        if (isChosen && !opts?.skipSelectionMarks) {
          const size = Math.min(opt.width, opt.height);
          const glyphSize = size * selectionMarkScale;
          const cx = opt.x + (opt.width - glyphSize) / 2;
          const cy = opt.y + (opt.height - glyphSize) / 2;
          drawVectorGlyph(page, selectedMarkGlyph, cx, cy, glyphSize, SELECTION_MARK_INK, MARK_OPACITY);
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
          // Route through pickFont so a recipient who pre-fills a
          // text input with CJK (e.g. a handwritten Chinese name in
          // the "Driver name" blank) renders correctly in the
          // flattened email copy too.
          const tiFont = await pickFont(String(initialValue), false, false);
          page.drawText(String(initialValue), {
            x: ti.x + 2,
            y: textY,
            size: fontSize,
            font: tiFont,
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

      // If the pre-fill contains CJK, the field needs to be rendered with
      // the CJK font rather than pdf-lib's default Helvetica — otherwise
      // `pdfDoc.save()` throws "WinAnsi cannot encode <char>" when it
      // builds the widget appearance stream, which crashes the WHOLE
      // export and the recipient gets no PDF at all (matching the
      // "input field is missing" symptom). On English-only inputs we
      // keep Helvetica so the embedded font set stays minimal.
      const widgetFont = containsCjk(String(initialValue))
        ? await ensureCjkFont()
        : null;

      const tf = form.createTextField(fieldName);
      if (initialValue) {
        try {
          tf.setText(initialValue);
        } catch (err) {
          console.warn(
            `[pdf-generate] Skipping pre-fill for text input "${ti.label ?? ti.id}" — value contains characters the embedded font cannot encode:`,
            err,
          );
        }
      }
      if (ti.multiline) tf.enableMultiline();

      tf.addToPage(page, {
        x: ti.x,
        y: ti.y,
        width: ti.width,
        height: ti.height,
        borderWidth: 0,
        backgroundColor: rgb(0.9, 0.95, 1),
        ...(widgetFont ? { font: widgetFont } : {}),
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
