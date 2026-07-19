/**
 * Voyage AI embeddings + reranking (Anthropic's recommended embedding partner).
 * Claude has no embedding model, so retrieval runs on voyage-3.5 (1024-dim) for
 * the first-stage search and rerank-2.5 (a cross-encoder) for precise ranking.
 * Generation runs on Claude — see docs/RAG.md and docs/AGENTIC_RAG.md.
 */
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";
export const EMBED_MODEL = "voyage-3.5";
export const EMBED_DIM = 1024;
export const RERANK_MODEL = "rerank-2.5";

type InputType = "document" | "query";

async function embed(input: string[], inputType: InputType): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set.");

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input,
      model: EMBED_MODEL,
      input_type: inputType,
      output_dimension: EMBED_DIM,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Voyage embedding failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embed a batch of documents (chunks) for ingestion. Batched to respect limits. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  const BATCH = 96;
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await embed(texts.slice(i, i + BATCH), "document")));
  }
  return out;
}

/** Embed a single search query. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text], "query");
  return v;
}

export interface RerankHit {
  /** index into the documents array passed in. */
  index: number;
  /** relevance score; higher is more relevant. */
  score: number;
}

/**
 * Cross-encoder reranking. The embedding search (a bi-encoder) casts a wide net
 * quickly; this reads each (query, document) pair together and scores true
 * relevance, so the best chunks rise to the top. Two-stage retrieve-then-rerank
 * is the single biggest accuracy lever after chunking — see docs/AGENTIC_RAG.md.
 */
export async function rerank(
  query: string,
  documents: string[],
  topK?: number
): Promise<RerankHit[]> {
  if (documents.length === 0) return [];
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set.");

  const res = await fetch(VOYAGE_RERANK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      documents,
      model: process.env.VOYAGE_RERANK_MODEL || RERANK_MODEL,
      top_k: topK ?? documents.length,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Voyage rerank failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as {
    data: { index: number; relevance_score: number }[];
  };
  return json.data
    .map((d) => ({ index: d.index, score: d.relevance_score }))
    .sort((a, b) => b.score - a.score);
}
