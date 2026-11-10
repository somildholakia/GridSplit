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
