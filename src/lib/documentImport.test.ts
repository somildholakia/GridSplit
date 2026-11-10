import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocxText, extractDocxXmlText, extractPdfText } from "./documentImport";

function createTextPdf(text: string): Blob {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = "BT\n/F1 12 Tf\n72 720 Td\n(" + escaped + ") Tj\nET";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    "5 0 obj\n<< /Length " + new TextEncoder().encode(stream).length + " >>\nstream\n" + stream + "\nendstream\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += object;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";
  return new Blob([pdf], { type: "application/pdf" });
}

describe("local document text import", () => {
  it("extracts DOCX paragraph text, entities, tabs and line breaks", () => {
    const xml = "<?xml version=\"1.0\"?>"
      + "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
      + "<w:body>"
      + "<w:p><w:r><w:t>Rain &amp; thunder</w:t></w:r></w:p>"
      + "<w:p><w:r><w:t>Character:</w:t><w:tab/><w:t>Maya</w:t><w:br/><w:t>Hello&#33;</w:t></w:r></w:p>"
      + "</w:body></w:document>";
    expect(extractDocxXmlText(xml)).toBe("Rain & thunder\nCharacter:\tMaya\nHello!");
  });

  it("opens a DOCX zip archive and reads the main document part", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>Scene one.</w:t></w:r></w:p></w:body></w:document>");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const blob = new Blob([bytes]);
    await expect(extractDocxText(blob)).resolves.toBe("Scene one.");
  });

  it("rejects an invalid DOCX document part", () => {
    expect(() => extractDocxXmlText("<not-a-word-document/>")).toThrow("valid Word document part");
  });

  it("extracts selectable PDF text locally", async () => {
    await expect(extractPdfText(createTextPdf("Scene 1: Arrival"), { workerSrc: new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href })).resolves.toContain("Scene 1: Arrival");
  });

  it("reports scanned or text-free PDFs clearly", async () => {
    await expect(extractPdfText(createTextPdf(""), { workerSrc: new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href })).rejects.toThrow("No selectable text was found");
  });

  it("rejects non-PDF input", async () => {
    await expect(extractPdfText(new Blob(["not a PDF"]), { workerSrc: new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href })).rejects.toThrow("Could not read this PDF");
  });
});
