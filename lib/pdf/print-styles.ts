/**
 * Shared print/PDF stylesheet for HTML-rendered documents.
 *
 * Lives in `lib/pdf/` (not in any single component) because it needs
 * to be imported by BOTH:
 *
 *   - `components/policies/tabs/DocumentsTab.tsx` (client)
 *     -> writes it into the print iframe used by the "Print / PDF"
 *        button so the user's browser print dialog renders the same
 *        layout the email PDF will have.
 *   - `lib/pdf/html-to-pdf.ts` (server)
 *     -> wraps the HTML body sent from the client before handing it
 *        to Puppeteer for PDF generation, so the emailed attachment
 *        is byte-identical to what the user sees in their print
 *        preview.
 *
 * Keeping this in one place means a font / margin / page-size tweak
 * is a single edit and can never drift between print and email PDF.
 *
 * The flex column on `body` + `body > div` lets the document's footer
 * use `margin-top:auto` to anchor itself to the bottom of an A4 sheet
 * (signature line, page-numbers row). For tall multi-page documents
 * the wrapper grows naturally and the footer just trails the last
 * section instead — same behavior as a normal block layout.
 */
export const PRINT_PAGE_STYLES = `
  @page { size: A4; margin: 10mm; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #1a1a1a;
    margin: 0;
    padding: 16px;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  body > div { flex: 1 0 auto; display: flex; flex-direction: column; }
  @media print {
    body { padding: 0; min-height: calc(297mm - 20mm); }
  }
`;

/**
 * Wrap a body HTML fragment into a complete printable document with
 * `PRINT_PAGE_STYLES` applied. Same wrapper used by both the client's
 * print iframe and the server-side Puppeteer HTML→PDF renderer, so the
 * PDF the recipient gets in their inbox matches the user's preview
 * exactly.
 */
export function wrapHtmlForPrint(bodyHtml: string, title = "Document"): string {
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>${PRINT_PAGE_STYLES}</style></head><body>${bodyHtml}</body></html>`;
}
