import { cn, hueFrom } from "@/lib/utils";

export function TagChip({ tag, className }: { tag: string; className?: string }) {
  const hue = hueFrom(tag);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px text-2xs font-medium",
        className
      )}
      style={{
        color: `hsl(${hue} 70% 72%)`,
        background: `hsl(${hue} 60% 50% / 0.13)`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 60% 55% / 0.22)`,
      }}
    >
      {tag}
    </span>
  );
}
