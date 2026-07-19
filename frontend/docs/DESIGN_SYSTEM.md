# Design system

Direction (from `second-brain-design-brief.md`): AI-native, calm and dense, Notion-meets-Linear. Near-black slate base, one confident gold accent, monospace for IDs/timestamps, rounded-but-tight corners, subtle borders over heavy shadows. Dark is the default.

## Tokens

Defined as CSS variables in `src/app/globals.css` (`:root`/`.dark` and `.light`), consumed via Tailwind semantic colours in `tailwind.config.ts`. **Never hardcode a hex in a component.**

| Token | Dark | Meaning |
|---|---|---|
| `bg` | `#07080b` | app base |
| `surface` / `surface-2` / `surface-3` | raised layers |
| `border` / `border-strong` | hairlines |
| `text` / `text-muted` / `text-faint` | `#e7e9ee` … | text hierarchy |
| `accent` / `accent-hover` / `accent-fg` | `#f5c518` | the one accent + text-on-gold |
| `todo` `progress` `blocked` `done` | task status |
| `danger` `warn` `ok` `info` | semantic |

Fonts: `font-sans` (system UI) for everything, `font-mono` for IDs, timestamps, counts (`.mono` helper adds tabular numerals). Radii: `sm 5px` … `xl 14px`. Shadows: `card`, `pop`, `glow`.

## Component library (`src/components/ui`)

Reusable primitives — reach for these before inventing:

- `Button` (primary/ghost/outline/subtle/danger, sizes incl. icon)
- `Avatar` / `AvatarEmpty`, `Logo` / `Wordmark`
- `Dropdown` + `MenuItem` (the popover engine behind every picker)
- `Modal` + `Field` + `inputClass`
- `DueDateChip` (neutral/soon/overdue states), `PriorityIndicator` + `PriorityDot`, `TagChip`, `SubtaskProgress`, `StatusControl`, `Skeleton`

Task-specific composed components live in `components/task/` (`TaskRow`, `TaskCard`, `TaskDrawer`, `Pickers`).

## Principles

1. **Density over whitespace** — power-user tool. Rows are compact (~34px), meta is right-aligned and appears on hover.
2. **One accent** — gold signals "primary / AI / now". Do not introduce a second brand colour; use semantic tokens for meaning.
3. **Borders, not shadows** — separation comes from `border` hairlines and surface steps; shadows are reserved for floating layers (`pop`).
4. **Monospace for machine data** — ids, counts, timestamps use `.mono` + tabular nums.
5. **Motion is subtle** — `fade-in` / `slide-in` on mount, `pulse-dot` for loading. Nothing bouncy.
6. **Keyboard-first** — Enter commits inline edits, Escape cancels/closes, Enter sends in the composer.

## Adding UI

New colour -> add the variable to both themes in `globals.css` and a token in `tailwind.config.ts`. New primitive -> `components/ui/`, typed props, `"use client"` only if stateful. Keep the hover-reveal pattern for row actions consistent across views.
