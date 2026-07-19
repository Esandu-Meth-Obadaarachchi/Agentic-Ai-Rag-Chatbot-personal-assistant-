# Setup

Second Brain runs against your own Firebase, Voyage, Pinecone and Anthropic accounts. Nothing is hosted for you — you own the data.

> ## Already provisioned (this repo's instance)
>
> The Firebase backend is set up and wired in `.env.local` (untracked). You do **not** need to redo steps 1–2 unless you are starting a fresh instance.
>
> - **Project:** `second-brain-fbf414` (owner `eobadaarachchi@gmail.com`), pinned in `.firebaserc`
> - **Google sign-in:** enabled · **Firestore:** live in `asia-south1` · **Rules:** deployed
> - **Admin SDK key:** generated for `firebase-adminsdk-fbsvc@…` and set in `.env.local` (verified working)
> - **Pending:** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PINECONE_API_KEY` (the agent side — see steps 3–5)
>
> Just `npm install && npm run dev`. The sections below are the from-scratch guide for a new environment.

## 1. Install

```bash
npm install
cp .env.example .env.local
```

## 2. Firebase (auth + database)

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication** -> Sign-in method -> enable **Google**.
3. **Firestore Database** -> Create database (production mode).
4. Project settings -> General -> Your apps -> add a **Web app**. Copy the config into the `NEXT_PUBLIC_FIREBASE_*` vars in `.env.local`.
5. Project settings -> Service accounts -> **Generate new private key**. From that JSON put:
   - `project_id`  -> `FIREBASE_ADMIN_PROJECT_ID`
   - `client_email` -> `FIREBASE_ADMIN_CLIENT_EMAIL`
   - `private_key`  -> `FIREBASE_ADMIN_PRIVATE_KEY` (keep the `\n` escapes, wrap in double quotes)
6. Deploy the security rules:
   ```bash
   npm i -g firebase-tools && firebase login
   firebase use <your-project-id>
   firebase deploy --only firestore:rules
   ```
   (Or paste `firestore.rules` into the console -> Firestore -> Rules.)
7. Add `localhost` to Authentication -> Settings -> Authorized domains (it is there by default).

## 3. Voyage AI (embeddings)

1. Get a key at <https://dash.voyageai.com>.
2. Set `VOYAGE_API_KEY`. Model is `voyage-3.5` (1024-dim), set in `src/lib/ai/voyage.ts`.

## 4. Pinecone (vector store)

1. Create an index at <https://app.pinecone.io>: **dimension 1024**, **metric cosine** (must match Voyage).
2. Set `PINECONE_API_KEY` and `PINECONE_INDEX_NAME` (default `second-brain`).

## 5. Anthropic (the agent)

1. Get a key at <https://console.anthropic.com>.
2. Set `ANTHROPIC_API_KEY`. The model (`claude-opus-4-8`) is set in `src/lib/ai/anthropic.ts`.

## 6. Run

```bash
npm run dev   # http://localhost:3000
```

Sign in with Google. On first sign-in the app seeds three workspaces (Office / Freelance / LeadX) with sample projects and tasks so nothing is empty.

## What works without every key

- **Firebase only** — the whole task manager (projects, tasks, all four views) works.
- **+ Voyage + Pinecone** — document ingestion + smart linking.
- **+ Anthropic** — the agent chat and standup answers.

Missing keys fail gracefully: the agent surface shows a clear message, the knowledge upload reports the error per file.
