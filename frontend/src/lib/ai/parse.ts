/**
 * Document parsing for ingestion. PDFs via pdf-parse, DOCX via mammoth, and
 * everything text-like (md, code, txt, csv) as raw UTF-8. Server-only.
 */
export type ParsedDoc = { text: string; type: string };

export async function parseFile(filename: string, mime: string, buffer: Buffer): Promise<ParsedDoc> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "pdf" || mime === "application/pdf") {
    const pdf = (await import("pdf-parse")).default;
    const data = await pdf(buffer);
    return { text: data.text, type: "pdf" };
  }

  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value, type: "docx" };
  }

  // text, markdown, code, csv, json…
  const codeExts = ["md", "txt", "csv", "json", "ts", "tsx", "js", "jsx", "py", "java", "sql", "yaml", "yml"];
  const type = ext === "md" ? "markdown" : codeExts.includes(ext) ? "code" : "text";
  return { text: buffer.toString("utf-8"), type };
}
