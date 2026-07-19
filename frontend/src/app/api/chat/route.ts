import { NextResponse } from "next/server";

/**
 * Proxy to the FastAPI RAG backend.
 *
 * The RAG brain now lives in the Python service (backend/). This route forwards
 * the request — Firebase ID token and all — to FastAPI and passes the JSON back,
 * so the UI keeps calling /api/chat exactly as before. Point RAG_API_URL at the
 * backend (local: http://localhost:8000; prod: the ECS service URL).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API = process.env.RAG_API_URL || "http://localhost:8000";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const body = await req.text();
  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body,
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backend unreachable" },
      { status: 502 }
    );
  }
}
