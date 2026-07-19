import { NextResponse } from "next/server";

/**
 * Proxy to the FastAPI RAG backend (ingestion).
 *
 * Forwards the multipart form (file or pasted text) and the Firebase ID token to
 * FastAPI, which parses -> chunks -> embeds -> upserts to Pinecone. See
 * api/chat/route.ts for the RAG_API_URL setup.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API = process.env.RAG_API_URL || "http://localhost:8000";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  try {
    const form = await req.formData();
    const res = await fetch(`${API}/api/ingest`, {
      method: "POST",
      headers: { authorization: auth }, // let fetch set the multipart content-type + boundary
      body: form,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backend unreachable" },
      { status: 502 }
    );
  }
}
