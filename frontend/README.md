<div align="center">

# 🌙 Lune AI — Your Personal Workspace

**An AI-native project + knowledge manager. Notion-meets-Linear, powered by Claude.**

Projects · tasks · docs · a knowledge base, and a Claude agent that reasons across all of it.
Live at **https://esa-ai-personal-assistant.netlify.app** (codebase name: `second-brain`).

</div>

---

## What it does

- **Execution** — Workspaces (per business) → Projects → Tasks → recursive Subtasks. Seven synced views: **Tree**, **Board** (drag between columns), **List**, **Calendar** (drag to reschedule), **Map** (React Flow mind map), **Draw** (Excalidraw whiteboard) and **Docs**.
- **Today** — everything due today across every workspace, plus a per-user day planner notebook.
- **Pages** — Notion-style block documents (BlockNote) at workspace or project level, nestable.
- **Knowledge** — upload PDFs, DOCX, notes or code. They are chunked, embedded with **Voyage** and stored per-project in **Pinecone**.
- **The brain** — a **Claude (`claude-opus-4-8`)** agent that answers questions from your documents, and creates/updates tasks by chatting. Plus a **daily standup** (overdue / due today / blocked / suggested).
- **Sharing** — invite teammates by email with owner/admin/member/viewer roles, scoped to the whole workspace or specific projects.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Firebase Auth (Google) + Firestore · Anthropic Claude · Voyage embeddings · Pinecone · @dnd-kit · reactflow · Excalidraw · BlockNote. Hosted on Netlify.

Dark-first design system, one gold accent, per-workspace data isolation.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in Firebase, Voyage, Pinecone, Anthropic
npm run dev                  # http://localhost:3000
```

Full step-by-step (Firebase project, service account, Pinecone index dimensions, rules deploy) is in **[docs/SETUP.md](docs/SETUP.md)**. On first sign-in the app seeds sample workspaces so nothing is empty.

## Docs

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Working guide for Claude Code (start here to change code) |
| [docs/SETUP.md](docs/SETUP.md) | Get it running |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers + request flows |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Firestore collections + isolation |
| [docs/RAG.md](docs/RAG.md) | Embeddings, Pinecone, the agent + tools |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Tokens + component library |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phase status + what's next |

## Scripts

```bash
npm run dev        # dev server
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm run lint       # next lint
```

## Security

Model + embedding + vector keys are server-only (API routes). Firestore rules isolate every workspace by `memberIds`. See `firestore.rules`. Never commit `.env.local`.
