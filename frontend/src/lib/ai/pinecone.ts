import { Pinecone } from "@pinecone-database/pinecone";
import type { RetrievedChunk } from "@/lib/types";

/**
 * Pinecone vector store. Each project owns a namespace (project.ragNamespace),
 * keeping every project's knowledge isolated inside one index.
 */
let client: Pinecone | null = null;

function pc(): Pinecone {
  if (!client) {
    if (!process.env.PINECONE_API_KEY) throw new Error("PINECONE_API_KEY is not set.");
    client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  }
  return client;
}

function index() {
  const name = process.env.PINECONE_INDEX_NAME || "second-brain";
  return pc().index(name);
}

export interface VectorMeta {
  text: string;
  source: string;
  project: string;
  type: string;
  uploadedAt: string;
  [key: string]: string;
}

export async function upsertChunks(
  namespace: string,
  vectors: { id: string; values: number[]; metadata: VectorMeta }[]
) {
  const ns = index().namespace(namespace);
  const BATCH = 100;
  for (let i = 0; i < vectors.length; i += BATCH) {
    await ns.upsert(vectors.slice(i, i + BATCH));
  }
}

export async function queryNamespace(
  namespace: string,
  vector: number[],
  topK = 5
): Promise<RetrievedChunk[]> {
  const res = await index()
    .namespace(namespace)
    .query({ vector, topK, includeMetadata: true });
  return (res.matches ?? []).map((m) => {
    const meta = (m.metadata ?? {}) as Partial<VectorMeta>;
    return {
      id: m.id,
      score: m.score ?? 0,
      text: meta.text ?? "",
      source: meta.source ?? "unknown",
      project: meta.project,
    };
  });
}

/** Query several project namespaces and merge by score — cross-project search. */
export async function queryNamespaces(
  namespaces: string[],
  vector: number[],
  topK = 6
): Promise<RetrievedChunk[]> {
  if (namespaces.length === 0) return [];
  const per = Math.max(2, Math.ceil(topK / namespaces.length));
  const results = await Promise.all(
    namespaces.map((ns) => queryNamespace(ns, vector, per).catch(() => []))
  );
  return results
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
