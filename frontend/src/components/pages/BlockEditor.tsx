"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { PartialBlock } from "@blocknote/core";

/**
 * The Notion-style block editor (BlockNote). Touches `window`, so it is only
 * ever loaded via a dynamic ssr:false import. Initial content is applied once
 * at mount; the parent remounts it (via `key`) when a different page opens.
 */
export default function BlockEditor({
  initialContent,
  onChange,
  theme,
}: {
  initialContent: PartialBlock[] | undefined;
  onChange: (json: string) => void;
  theme: "light" | "dark";
}) {
  const editor = useCreateBlockNote({ initialContent });
  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      onChange={() => onChange(JSON.stringify(editor.document))}
      className="sb-blocknote"
    />
  );
}
