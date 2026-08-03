import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Segment {
  value: number;
  className: string;
  label: string;
}

interface Props {
  segments: Segment[];
  className?: string;
  height?: number;
}

/**
 * Animated horizontal stacked bar. Fills in on mount and re-animates when
 * segment values change. Respects prefers-reduced-motion.
 */
export const MiniStackedBar = ({ segments, className, height = 8 }: Props) => {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const [play, setPlay] = useState(0);
  useEffect(() => {
    setPlay((p) => p + 1);
  }, [total, segments.map((s) => s.value).join("|")]);

  const trackClass = "w-full rounded-full bg-muted ring-1 ring-inset ring-border/70";

  if (total <= 0) {
    return (
      <div
        className={cn(trackClass, className)}
        style={{ height }}
        aria-hidden
      />
    );
  }

  return (
    <div
      className={cn("relative overflow-hidden", trackClass, className)}
      style={{ height }}
      role="img"
      aria-label={segments.map((s) => `${s.label} ${((s.value / total) * 100).toFixed(0)}%`).join(", ")}
    >
      <div className="flex h-full w-full">
        {segments.map((seg, i) => {
          const pct = (Math.max(0, seg.value) / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={`${i}-${play}`}
              className={cn("h-full origin-left animate-bar-grow", seg.className)}
              style={{ width: `${pct}%`, animationDelay: `${i * 80}ms` }}
              title={`${seg.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
    </div>
  );
};

export default MiniStackedBar;
