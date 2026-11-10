import JSZip from "jszip";

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, key: string) => {
    const name = key.toLowerCase();
    if (name === "amp") return "&";
    if (name === "lt") return "<";
    if (name === "gt") return ">";
    if (name === "quot") return '"';
    if (name === "apos") return "'";
    const codePoint = name.startsWith("#x")
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    try {
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    } catch {
      return entity;
    }
  });
}

/** Extracts paragraph text from the main WordprocessingML document part. */
export function extractDocxXmlText(xml: string): string {
  if (!/<(?:[\w.-]+:)?document\b/.test(xml)) {
    throw new Error("The DOCX file does not contain a valid Word document part.");
  }

  const paragraphs = xml.match(/<(?:[\w.-]+:)?p\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?p\s*>/g) ?? [];
  if (!paragraphs.length) {
    throw new Error("No readable paragraphs were found in this DOCX file.");
  }

  const lines = paragraphs.map((paragraph) => {
    const pieces: string[] = [];
    const tokens = /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t\s*>|<(?:[\w.-]+:)?(tab|br|cr)\b[^>]*\/>/g;
    for (const match of paragraph.matchAll(tokens)) {
      if (match[1] !== undefined) pieces.push(decodeXmlEntities(match[1]));
      else if (match[2] === "tab") pieces.push("\t");
      else pieces.push("\n");
    }
    return pieces.join("");
  });

  return lines.join("\n").trim();
}

/** Reads DOCX text locally in the browser; no upload or remote conversion is used. */
export async function extractDocxText(file: Blob): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error("Could not open this DOCX file. Check that it is a valid, unencrypted Word document.");
  }

  const document = zip.file("word/document.xml");
  if (!document) {
    throw new Error("This DOCX file is missing word/document.xml.");
  }
  return extractDocxXmlText(await document.async("string"));
}



/**
 * Reads selectable PDF text locally through PDF.js. The worker is bundled with
 * the application so PDF parsing does not require a CDN or remote service.
 */
export async function extractPdfText(file: Blob, options: { workerSrc?: string } = {}): Promise<string> {
  if (file.size === 0) {
    throw new Error("The PDF file is empty.");
  }

  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = options.workerSrc ?? workerModule.default;

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useWorkerFetch: false,
  });

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > 500) {
      throw new Error("This PDF has more than 500 pages. Split it into smaller files before importing.");
    }

    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let line = "";
      let lastY: number | null = null;
      let lastRight: number | null = null;

      const flushLine = () => {
        const normalized = line.replace(/[\t ]+$/g, "").trimStart();
        if (normalized) lines.push(normalized);
        line = "";
        lastY = null;
        lastRight = null;
      };

      for (const item of content.items) {
        if (!("str" in item)) continue;
        const text = item.str;
        if (!text) continue;

        const x = item.transform[4] ?? 0;
        const y = item.transform[5] ?? 0;
        const fontSize = Math.max(1, Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0) || item.height || 10);

        if (lastY !== null && Math.abs(y - lastY) > Math.max(2, fontSize * 0.45)) {
          flushLine();
        } else if (lastRight !== null && x - lastRight > Math.max(1.5, fontSize * 0.15) && line && !/[\s]$/.test(line)) {
          line += " ";
        }

        line += text;
        lastY = y;
        lastRight = x + item.width;
        if (item.hasEOL) flushLine();
      }

      flushLine();
      pageTexts.push(lines.join("\n"));
      page.cleanup();
    }

    const extracted = pageTexts.join("\n\n").trim();
    if (!extracted) {
      throw new Error("No selectable text was found. This PDF may contain scanned images; OCR is not included in local import.");
    }
    return extracted;
  } catch (error) {
    if (error instanceof Error && /more than 500 pages|No selectable text/.test(error.message)) {
      throw error;
    }
    if (error instanceof Error && /password|encrypted/i.test(error.message)) {
      throw new Error("This PDF is password-protected. Remove its password before importing.");
    }
    throw new Error(error instanceof Error ? "Could not read this PDF: " + error.message : "Could not read this PDF file.");
  } finally {
    await loadingTask.destroy();
  }
}
