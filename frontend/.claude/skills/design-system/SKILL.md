---
name: design-system
description: How to design and build UI in Second Brain — the dark, dense, gold-accent Notion-meets-Linear system. Use whenever creating or restyling any screen, view, component, layout, empty state, or interaction. Covers tokens, spacing, motion, and the reusable primitives.
---

# Second Brain — UI/UX system

Build every surface to this system. The product is a power-user tool: **calm and dense**, dark-first, one confident gold accent, keyboard-fast. Reference: `docs/DESIGN_SYSTEM.md`, `src/app/globals.css`, `tailwind.config.ts`.

## The rules that matter most

1. **Tokens only, never raw hex.** Use `bg surface surface-2 surface-3 border border-strong text text-muted text-faint accent accent-hover accent-fg` and semantics `danger warn ok info` + status `todo progress blocked done`. A new colour is added in `globals.css` (both `.dark` and `.light`) and `tailwind.config.ts`, not inline.
2. **One accent.** Gold (`accent`) means primary / AI / now. Never add a second brand colour. Meaning is carried by semantic tokens.
3. **Borders over shadows.** Separation = `border` hairlines + surface steps (`surface` → `surface-2` → `surface-3`). Shadows (`shadow-card`, `shadow-pop`, `shadow-glow`) are only for floating layers and the accent.
4. **Density.** Rows ≈ 32–36px tall, `text-[13px]`/`text-[13.5px]` body, `text-2xs` for meta. Right-align row metadata; reveal per-row actions on hover (`opacity-0 group-hover:opacity-100`).
5. **Monospace for machine data.** IDs, counts, timestamps → `.mono` (adds tabular numerals).
6. **Motion is subtle.** `animate-fade-in` / `animate-slide-in` on mount, `animate-pulse-dot` for loading. Nothing bouncy, nothing over ~200ms.
7. **Keyboard-first.** Enter commits inline edits and sends the composer; Escape cancels/closes; inputs are borderless until focused.

## Layout scale

- Radii: `rounded-md` (8px) for controls/cards, `rounded-lg`/`rounded-xl` for panels. Tight, not pill-round (except chips/toggles).
- Spacing: gaps of `1.5`/`2`/`2.5`; page content in `max-w-4xl` (task views) or `max-w-2xl` (agent). Sidebar is `248px`.
- Icons: `lucide-react`, `h-3.5 w-3.5` in dense rows, `h-4 w-4` in nav, `strokeWidth` ~1.75–2.

## Reuse these primitives (do not reinvent)

`src/components/ui`: `Button` · `Avatar`/`AvatarEmpty` · `Logo`/`Wordmark` · `Dropdown`+`MenuItem` (the engine behind every picker/menu) · `Modal`+`Field`+`inputClass` · `DueDateChip` · `PriorityIndicator`/`PriorityDot` · `TagChip` · `SubtaskProgress` · `StatusControl` · `Skeleton`.

`src/components/task`: `TaskRow`, `TaskCard`, `TaskDrawer`, `Pickers` (Priority/Assignee/Due/Tag).

Any dropdown, menu, status/priority/assignee/date picker, or overflow menu → compose `Dropdown` + `MenuItem`. Any dialog → `Modal`.

## Patterns

- **Empty state**: centered, a `surface-2` rounded icon tile (`h-11 w-11`), a `text-sm` title, a `text-xs text-text-muted` line, and often an inline add affordance. See `TreeView` / project page.
- **Inline add**: `QuickAdd` (borderless input, dashed status circle). Enter adds, blur commits, Escape cancels.
- **Loading**: `Skeleton`/`RowSkeleton` with the `shimmer` utility; `Logo` with `animate-pulse-dot` for full-screen.
- **Status/priority/due**: always via `StatusControl`, `PriorityIndicator`, `DueDateChip` so colour states stay consistent (`overdue` = danger, `today`/`soon` = warn).
- **Cards**: `.card` (surface + border + `rounded-[11px]`); `.glass` for popovers/standup; `.lit` for a subtle top gradient on hero surfaces.

## Definition of done for a UI change

- No raw hex; tokens throughout. `"use client"` only if stateful. Reused primitives. Consistent across the four task views + drawer if it touches tasks. `npm run typecheck` clean. Dark and light both legible (check contrast on `text-muted`/`text-faint`).
