/**
 * Agentic retrieval.
 *
 * Instead of a single embed-and-fetch, this runs the loop the RAG docs describe:
 *
 *   rewrite the query -> cast a wide net (bi-encoder) -> cross-encoder rerank
 *   -> grade whether the chunks answer the question -> retry on a weak grade
 *
 * A weak grade reformulates the query and searches again, up to MAX_ATTEMPTS.
 * This is what turns plain top-k retrieval into something accurate. See
 * docs/AGENTIC_RAG.md for the why behind each step.
 */
import { complete } from "./anthropic";
import { embedQuery, rerank } from "./voyage";
import { queryNamespaces } from "./pinecone";
import type { RetrievedChunk } from "@/lib/types";

const CANDIDATES = 20; // wide net from the bi-encoder (recall)
const KEEP = 4; // kept after the cross-encoder rerank (precision, and prompt size)
const MAX_ATTEMPTS = 2; // grade-and-retry ceiling (each retry costs helper calls)

export interface AgenticRetrieval {
  chunks: RetrievedChunk[];
  /** the final search query actually used, after any rewrites. */
  query: string;
  /** how many retrieve attempts ran (1..MAX_ATTEMPTS). */
  attempts: number;
  /** the grader's verdict on the returned chunks. */
  grade: "good" | "weak";
}

/**
 * Rewrite a raw question into a search-optimised query. On a retry it is told
 * the previous query was weak, so it comes at the topic from a different angle.
 */
async function rewriteQuery(raw: string, previous?: string): Promise<string> {
  const prompt = previous
    ? `The search query "${previous}" returned weak results for this question:\n"${raw}"\n\nWrite ONE different, more effective search query. Use the key entities and terms. Return only the query, no preamble.`
    : `Turn this into ONE concise search query optimised for semantic document retrieval. Keep the key entities and terms. Return only the query, no preamble.\n\nQuestion: ${raw}`;
  const out = await complete(prompt, { maxTokens: 80 });
  const cleaned = out.replace(/^["']|["']$/g, "").trim();
  return cleaned || raw;
}

/**
 * Retrieve a wide candidate set across the given project namespaces, then
 * cross-encoder rerank down to the best few. The returned chunks carry the
 * rerank score in `score`.
 */
export async function retrieveAndRerank(
  namespaces: string[],
  query: string,
  keep = KEEP
): Promise<RetrievedChunk[]> {
  if (namespaces.length === 0) return [];
  const vector = await embedQuery(query);
  const candidates = await queryNamespaces(namespaces, vector, CANDIDATES);
  if (candidates.length === 0) return [];

  const hits = await rerank(
    query,
    candidates.map((c) => c.text),
    keep
  );
  return hits.map((h) => ({ ...candidates[h.index], score: h.score }));
}

/** Grade whether the chunks actually answer the question. Cheap Haiku call. */
async function gradeChunks(question: string, chunks: RetrievedChunk[]): Promise<"good" | "weak"> {
  if (chunks.length === 0) return "weak";
  const context = chunks.map((c, i) => `[${i + 1}] ${c.text.slice(0, 500)}`).join("\n\n");
  const verdict = await complete(
    `Question: ${question}\n\nRetrieved passages:\n${context}\n\nDo these passages contain enough information to answer the question? Reply with exactly one word: "good" or "weak".`,
    { maxTokens: 5 }
  );
  return /good/i.test(verdict) ? "good" : "weak";
}

/**
 * The full loop: rewrite -> retrieve+rerank -> grade, retrying on a weak grade
 * with a fresh query, up to MAX_ATTEMPTS. Returns the best set found.
 */
export async function agenticRetrieve(
  namespaces: string[],
  question: string
): Promise<AgenticRetrieval> {
  let query = await rewriteQuery(question);
  let best: RetrievedChunk[] = [];
  let attempts = 0;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts = i + 1;
    const chunks = await retrieveAndRerank(namespaces, query);
    if (chunks.length && (best.length === 0 || chunks[0].score > best[0].score)) {
      best = chunks;
    }
    const grade = await gradeChunks(question, chunks);
    if (grade === "good" || i === MAX_ATTEMPTS - 1) {
      return { chunks: chunks.length ? chunks : best, query, attempts, grade };
    }
    query = await rewriteQuery(question, query); // reformulate and retry
  }
  return { chunks: best, query, attempts, grade: "weak" };
}

/**
 * Groundedness self-check: is every factual claim in the answer supported by the
 * retrieved sources? Used to flag possible hallucination after generation.
 * Returns true when there is nothing to check (no sources were used).
 */
export async function checkGrounded(answer: string, chunks: RetrievedChunk[]): Promise<boolean> {
  if (chunks.length === 0) return true;
  const context = chunks.map((c, i) => `[${i + 1}] ${c.text.slice(0, 500)}`).join("\n\n");
  const verdict = await complete(
    `Sources:\n${context}\n\nAnswer:\n${answer}\n\nIs every factual claim in the answer supported by the sources above? Reply with exactly one word: "yes" or "no".`,
    { maxTokens: 5 }
  );
  return /yes/i.test(verdict);
}
