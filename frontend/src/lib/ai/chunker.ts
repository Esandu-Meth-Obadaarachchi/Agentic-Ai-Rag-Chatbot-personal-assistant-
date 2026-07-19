/** Recursive character splitter — ~1000 chars per chunk with 200 overlap. */
const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

export function chunkText(text: string, size = 1000, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= size) return clean ? [clean] : [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      // Prefer to break on the nicest separator within the window.
      for (const sep of SEPARATORS) {
        if (!sep) break;
        const idx = clean.lastIndexOf(sep, end);
        if (idx > start + size * 0.5) {
          end = idx + sep.length;
          break;
        }
      }
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
