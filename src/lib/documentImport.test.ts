import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocxText, extractDocxXmlText } from "./documentImport";

describe("local DOCX text import", () => {
  it("extracts paragraph text, entities, tabs and line breaks", () => {
    const xml = `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Rain &amp; thunder</w:t></w:r></w:p>
          <w:p><w:r><w:t>Character:</w:t><w:tab/><w:t>Maya</w:t><w:br/><w:t>Hello&#33;</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    expect(extractDocxXmlText(xml)).toBe("Rain & thunder\nCharacter:\tMaya\nHello!");
  });

  it("opens a DOCX zip archive and reads the main document part", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Scene one.</w:t></w:r></w:p></w:body></w:document>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const blob = new Blob([bytes]);
    await expect(extractDocxText(blob)).resolves.toBe("Scene one.");
  });

  it("rejects an invalid document part", () => {
    expect(() => extractDocxXmlText("<not-a-word-document/>")).toThrow("valid Word document part");
  });
});
