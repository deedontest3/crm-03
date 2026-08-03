import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type KpiAccent = "indigo" | "emerald" | "blue" | "teal" | "purple" | "amber";

const accentMap: Record<KpiAccent, {
  bar: string;
  glow: string;
  chipBg: string;
  chipText: string;
  numberText: string;
  wash: string;
}> = {
  indigo: {
    bar: "from-indigo-400 to-indigo-600",
    glow: "shadow-[0_0_18px_-2px_hsl(239_84%_67%/0.55)]",
    chipBg: "bg-indigo-500/10",
    chipText: "text-indigo-500",
    numberText: "text-foreground",
    wash: "from-indigo-500/[0.08]",
  },
  emerald: {
    bar: "from-emerald-400 to-emerald-600",
    glow: "shadow-[0_0_18px_-2px_hsl(160_84%_39%/0.55)]",
    chipBg: "bg-emerald-500/10",
    chipText: "text-emerald-500",
    numberText: "text-emerald-600 dark:text-emerald-400",
    wash: "from-emerald-500/[0.09]",
  },
  blue: {
    bar: "from-blue-400 to-blue-600",
    glow: "shadow-[0_0_18px_-2px_hsl(217_91%_60%/0.55)]",
    chipBg: "bg-blue-500/10",
    chipText: "text-blue-500",
    numberText: "text-blue-600 dark:text-blue-400",
    wash: "from-blue-500/[0.09]",
  },
  teal: {
    bar: "from-teal-400 to-teal-600",
    glow: "shadow-[0_0_18px_-2px_hsl(173_80%_40%/0.55)]",
    chipBg: "bg-teal-500/10",
    chipText: "text-teal-500",
    numberText: "text-teal-600 dark:text-teal-400",
    wash: "from-teal-500/[0.09]",
  },
  purple: {
    bar: "from-purple-400 to-purple-600",
    glow: "shadow-[0_0_18px_-2px_hsl(271_91%_65%/0.55)]",
    chipBg: "bg-purple-500/10",
    chipText: "text-purple-500",
    numberText: "text-purple-600 dark:text-purple-400",
    wash: "from-purple-500/[0.09]",
  },
  amber: {
    bar: "from-amber-400 to-amber-600",
    glow: "shadow-[0_0_18px_-2px_hsl(38_92%_50%/0.55)]",
    chipBg: "bg-amber-500/10",
    chipText: "text-amber-500",
    numberText: "text-amber-600 dark:text-amber-400",
    wash: "from-amber-500/[0.09]",
  },
};

interface Props {
  accent: KpiAccent;
  label: string;
  icon: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  index?: number;
  className?: string;
}

export const KpiCard = ({ accent, label, icon, headerAction, children, onClick, index = 0, className }: Props) => {
  const a = accentMap[accent];
  const interactive = !!onClick;
  return (
    <Card
      onClick={onClick}
      style={{ animationDelay: `${index * 60}ms` }}
      className={cn(
        "group relative overflow-hidden animate-rise-in h-full",
        "border border-border/70 bg-card/95 backdrop-blur-sm",
        "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg",
        interactive && "cursor-pointer",
        className,
      )}
    >
      {/* Left accent bar */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b",
          a.bar,
          "group-hover:" + a.glow.replace("shadow-", "shadow-"),
        )}
      />
      {/* Top gradient wash */}
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent", a.wash)}
      />
      {/* Sheen sweep on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <span className="absolute -inset-y-4 left-0 w-1/3 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 group-hover:opacity-100 group-hover:animate-sheen dark:via-white/10" />
      </span>

      <div className="relative flex h-full flex-col pl-4 pr-4 pt-4 pb-4">
        <div className="flex items-center justify-between pb-3">
          <span className="font-manrope text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </span>
          <div className="flex items-center gap-1">
            <div className={cn("p-2 rounded-full", a.chipBg)}>
              <span className={a.chipText}>{icon}</span>
            </div>
            {headerAction}
          </div>
        </div>
        <div className={cn("font-sora flex min-h-[84px] flex-1 flex-col", a.numberText)}>{children}</div>
      </div>
    </Card>
  );
};

export default KpiCard;
