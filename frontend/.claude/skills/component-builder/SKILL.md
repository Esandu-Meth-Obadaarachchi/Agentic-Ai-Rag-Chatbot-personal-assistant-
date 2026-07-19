---
name: component-builder
description: Conventions for adding a React component to Second Brain — file location, client/server boundary, props, tokens, and reuse. Use when creating any new component.
---

# Building a component

1. **Location**
   - Generic primitive → `src/components/ui/`
   - Task-specific → `src/components/task/`
   - A whole view → `src/components/views/` (and add a tab in `project/ProjectHeader.tsx` + `app/(app)/page.tsx`)
   - Agent surface → `src/components/agent/`

2. **Client vs server** — add `"use client"` only if the component uses hooks, state, event handlers, or browser APIs. Pure presentational components can stay server components.

3. **Props** — type them explicitly (no implicit `any`). Follow the existing shape: small, flat prop objects; callbacks named `onX`.

4. **Styling** — Tailwind semantic tokens only (see the `design-system` skill). Compose `cn()` from `@/lib/utils` for conditional classes. Reach for existing primitives (`Dropdown`, `Modal`, `Button`, pickers) before building new interaction code.

5. **Data** — never call Firestore directly. Read from `useWorkspace()`; mutate via `useTaskActions()`. Call APIs with `authedFetch`/`postJSON` from `@/lib/api` (they attach the Firebase ID token).

6. **Verify** — `npm run typecheck`. If it renders tasks, make sure the field shows consistently across Tree/Kanban/List/Calendar + `TaskDrawer`.

Keep the file focused; if it grows past ~200 lines, split the presentational part out. Prefer editing an existing component over adding a near-duplicate.
