import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PdfFieldMapping } from "@/lib/types/pdf-template";
import { resolveFieldValue, type MergeContext } from "./resolve-data";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

export async function generateFilledPdf(
  templateBytes: Buffer | Uint8Array,
  fields: PdfFieldMapping[],
  ctx: MergeContext,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const field of fields) {
    const pageIndex = field.page;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const text = resolveFieldValue(field, ctx);
    if (!text) continue;

    const fontSize = field.fontSize ?? 10;
    const color = field.fontColor ? hexToRgb(field.fontColor) : rgb(0, 0, 0);

    let x = field.x;
    if (field.align === "center" && field.width) {
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      x = field.x + (field.width - textWidth) / 2;
    } else if (field.align === "right" && field.width) {
      const textWidth = font.widthOfTextAtSize(text, fontSize);
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
  }

  return pdfDoc.save();
}
