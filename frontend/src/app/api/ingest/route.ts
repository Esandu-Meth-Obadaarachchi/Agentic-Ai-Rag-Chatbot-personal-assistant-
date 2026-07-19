import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { loadProject } from "@/lib/ai/server";
import { parseFile } from "@/lib/ai/parse";
import { chunkText } from "@/lib/ai/chunker";
import { embedDocuments } from "@/lib/ai/voyage";
import { upsertChunks, type VectorMeta } from "@/lib/ai/pinecone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ingest a document (multipart file) or pasted text into a project's knowledge
 * namespace: parse -> chunk -> Voyage embed -> Pinecone upsert.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const project = await loadProject(user.uid, projectId);

    const file = form.get("file") as File | null;
    let filename: string;
    let text: string;
    let type: string;

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
      const parsed = await parseFile(file.name, file.type, buffer);
      text = parsed.text;
      type = parsed.type;
    } else {
      const raw = String(form.get("text") ?? "");
      filename = String(form.get("title") ?? "Pasted note");
      text = raw;
      type = "text";
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "No readable text found in the document." }, { status: 400 });
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) return NextResponse.json({ error: "Nothing to index." }, { status: 400 });

    const embeddings = await embedDocuments(chunks);
    const uploadedAt = new Date().toISOString();
    const vectors = chunks.map((chunk, i) => ({
      id: `${randomUUID()}`,
      values: embeddings[i],
      metadata: {
        text: chunk,
        source: filename,
        project: project.name,
        type,
        uploadedAt,
      } satisfies VectorMeta,
    }));

    await upsertChunks(project.ragNamespace, vectors);

    return NextResponse.json({ chunksStored: chunks.length, filename, project: project.name });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("ingest error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ingest failed" },
      { status: 500 }
    );
  }
}
