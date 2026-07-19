import { cn } from "@/lib/utils";

/**
 * The Lune mark — a gold gradient crescent moon with a small accent star, set
 * in a dark medallion with a hairline gold ring and a soft glow. Rendered as an
 * SVG so it stays crisp at every size, from a 16px favicon to the login hero.
 */
export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  // Stable-ish unique ids so multiple logos on one page don't clash their defs.
  const uid = `lune-${size}`;
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center rounded-[28%] shadow-glow ring-1 ring-accent/25",
        className
      )}
      style={{
        width: size,
        height: size,
        background: "radial-gradient(120% 120% at 30% 20%, #14161d 0%, #0a0b0f 70%)",
      }}
      aria-hidden
    >
      <svg
        viewBox="0 0 100 100"
        width={size * 0.72}
        height={size * 0.72}
        fill="none"
        role="img"
      >
        <defs>
          <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbe6a2" />
            <stop offset="0.45" stopColor="#f5c518" />
            <stop offset="1" stopColor="#b8860b" />
          </linearGradient>
          <mask id={`${uid}-crescent`}>
            {/* white keeps, black cuts — the offset bite carves the crescent. */}
            <circle cx="46" cy="50" r="40" fill="white" />
            <circle cx="63" cy="42" r="34" fill="black" />
          </mask>
        </defs>
        {/* the crescent */}
        <circle cx="46" cy="50" r="40" fill={`url(#${uid}-gold)`} mask={`url(#${uid}-crescent)`} />
        {/* a single poised star in the crook of the moon */}
        <circle cx="74" cy="28" r="4.2" fill={`url(#${uid}-gold)`} />
      </svg>
    </div>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      <span className="text-[15px] font-semibold tracking-tight text-text">Lune AI</span>
    </div>
  );
}
