---
name: firestore-patterns
description: Data-access patterns for Second Brain — watchers, mutations, membership isolation, and adding fields/collections. Use when touching Firestore, the data layer, or security rules.
---

# Firestore patterns

Reference: `docs/DATA_MODEL.md`. Three flat collections: `workspaces`, `projects`, `tasks`. Every doc carries `memberIds`.

## Reading (client)

- Use the `onSnapshot` watchers in `src/lib/data/firestore.ts` (`watchWorkspaces`, `watchProjects`, `watchTasks`, `watchAllTasks`) surfaced through `WorkspaceContext`. Components read from `useWorkspace()`, not Firestore.
- Queries are single-field (`==` or `array-contains`) and sorted in JS — this avoids composite indexes. Keep it that way.

## Writing

- Client mutations: `useTaskActions()` (tasks) or the `create*/update*/delete*` functions in `firestore.ts`. Never `updateDoc`/`addDoc` inline in a component.
- Server mutations (the agent): `firebase-admin` in `src/lib/ai/tools.ts`. Admin **bypasses security rules**, so re-check membership first via `loadWorkspace`/`loadProject` (`src/lib/ai/server.ts`).
- Timestamps are numbers (`Date.now()`); `order` is a number for sibling ordering.

## Isolation (non-negotiable)

- Add `memberIds` to any new doc type and gate it in `firestore.rules`:
  ```
  function isMember(data) { return request.auth != null && request.auth.uid in data.memberIds; }
  allow read, update, delete: if isMember(resource.data);
  allow create: if isMember(request.resource.data);
  ```
- Denormalise `memberIds` onto child docs (projects/tasks copy the workspace's) so rules never need a cross-doc `get()`.

## Adding a task field

1. `src/lib/types.ts` — add to `Task`.
2. `firestore.ts` — set a default in `createTask` (and the seed).
3. `useTaskActions.ts` — add a setter if it is user-editable.
4. Surface it in the views/drawer that should show it, consistently.
5. `npm run typecheck`.

## After rules change

Remind the user: `firebase deploy --only firestore:rules`.
