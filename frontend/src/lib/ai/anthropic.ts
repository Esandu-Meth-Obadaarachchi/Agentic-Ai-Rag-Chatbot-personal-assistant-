import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "langsmith/wrappers/anthropic";

/**
 * The agent + RAG generation model. Set via the CLAUDE_MODEL env var so it can be
 * swapped without a code change; defaults to Haiku 4.5 — the cheapest tier
 * ($1/$5 per 1M). Point CLAUDE_MODEL at claude-opus-4-8 or claude-sonnet-5 for
 * higher answer quality at higher cost.
 */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL?.trim() || "claude-haiku-4-5";

/**
 * The cheap, fast model for the agentic-retrieval helper calls — query rewrite,
 * relevance grading and the groundedness check. Haiku 4.5 costs a fraction of
 * Opus, and these steps only need a short answer back. See docs/AGENTIC_RAG.md.
 */
export const CLAUDE_FAST_MODEL = "claude-haiku-4-5";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
    const raw = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // LangSmith tracing. A no-op unless LANGSMITH_TRACING=true and
    // LANGSMITH_API_KEY are set, so it is always safe to wrap. When enabled it
    // records every model call in the agent + retrieval loop.
    client = wrapAnthropic(raw);
  }
  return client;
}

/**
 * One-shot completion on the fast model, returning trimmed text. Used by the
 * agentic-retrieval helpers (rewrite / grade / groundedness) where we only need
 * a short string, not a full tool loop.
 */
export async function complete(
  prompt: string,
  opts: { system?: string; maxTokens?: number; model?: string } = {}
): Promise<string> {
  const resp = await anthropic().messages.create({
    model: opts.model ?? CLAUDE_FAST_MODEL,
    max_tokens: opts.maxTokens ?? 256,
    system: opts.system,
    messages: [{ role: "user", content: prompt }],
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
