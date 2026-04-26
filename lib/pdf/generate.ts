import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PdfFieldMapping, PdfPageInfo, PdfImageMapping, PdfDrawing } from "@/lib/types/pdf-template";
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
) {
  const strokeWidth = Math.max(0.8, size * 0.12);
  if (glyph === "✓" || glyph === "✔") {
    page.drawLine({
      start: { x: x + size * 0.12, y: y + size * 0.38 },
      end: { x: x + size * 0.38, y: y + size * 0.12 },
      thickness: strokeWidth,
      color,
    });
    page.drawLine({
      start: { x: x + size * 0.38, y: y + size * 0.12 },
      end: { x: x + size * 0.88, y: y + size * 0.82 },
      thickness: strokeWidth,
      color,
    });
    return true;
  }

  if (glyph === "✗" || glyph === "✕" || glyph === "×") {
    page.drawLine({
      start: { x: x + size * 0.16, y: y + size * 0.16 },
      end: { x: x + size * 0.84, y: y + size * 0.84 },
      thickness: strokeWidth,
      color,
    });
    page.drawLine({
      start: { x: x + size * 0.84, y: y + size * 0.16 },
      end: { x: x + size * 0.16, y: y + size * 0.84 },
      thickness: strokeWidth,
      color,
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
    });
    return true;
  }

  return false;
}

export async function generateFilledPdf(
  templateBytes: Buffer | Uint8Array,
  fields: PdfFieldMapping[],
  ctx: MergeContext,
  opts?: {
    pages?: PdfPageInfo[];
    images?: PdfImageMapping[];
    drawings?: PdfDrawing[];
    loadImage?: (storedName: string) => Promise<Buffer>;
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

  return pdfDoc.save();
}
