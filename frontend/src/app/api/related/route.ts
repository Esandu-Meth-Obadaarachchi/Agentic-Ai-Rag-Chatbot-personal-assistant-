import { NextResponse } from "next/server";

/** Proxy to the FastAPI RAG backend (smart linking). See api/chat/route.ts. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = process.env.RAG_API_URL || "http://localhost:8000";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const body = await req.text();
  try {
    const res = await fetch(`${API}/api/related`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    // Smart-linking is best-effort; never surface a hard error to the UI.
    return NextResponse.json({ chunks: [] });
  }
}
