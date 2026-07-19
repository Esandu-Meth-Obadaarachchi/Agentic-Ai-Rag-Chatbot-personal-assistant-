import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cn("shimmer rounded-md bg-surface-2", className)} style={style} />;
}

const WIDTHS = ["45%", "62%", "38%", "70%", "54%"];

export function RowSkeleton({ i = 0 }: { i?: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton className="h-4 w-4 rounded-full" />
      <Skeleton className="h-3.5 flex-1" style={{ maxWidth: WIDTHS[i % WIDTHS.length] }} />
      <Skeleton className="h-4 w-14 rounded-full" />
    </div>
  );
}
