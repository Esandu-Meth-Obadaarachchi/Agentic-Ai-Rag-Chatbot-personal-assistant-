import { cn, hueFrom, initials } from "@/lib/utils";

export function Avatar({
  name,
  src,
  size = 22,
  className,
  ring,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const hue = hueFrom(name || "?");
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? ""}
        width={size}
        height={size}
        className={cn(
          "shrink-0 rounded-full object-cover",
          ring && "ring-2 ring-bg",
          className
        )}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-medium text-white",
        ring && "ring-2 ring-bg",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue} 62% 42%), hsl(${(hue + 40) % 360} 60% 32%))`,
      }}
      title={name ?? undefined}
    >
      {initials(name)}
    </div>
  );
}

/** Unassigned placeholder. */
export function AvatarEmpty({ size = 22 }: { size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-text-faint"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      title="Unassigned"
    >
      +
    </div>
  );
}
