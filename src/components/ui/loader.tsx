import { cn } from "@/lib/utils";

/**
 * Unified app loader — the ONLY loading indicator used across the app.
 *
 * Visual: pulsing brand logo, always centered. No orbiting ring, no arc spinner.
 *
 * Variants (all render the same pulsing logo, sized for context):
 *  - "page":   full content-area centered loader with optional label. Used for
 *              route Suspense fallbacks and auth/permission gates.
 *  - "panel":  centered pulse for section-level Suspense / lazy panels.
 *  - "inline": small pulse for buttons and row-level "loading" states.
 */

type Variant = "page" | "panel" | "inline";

interface AppLoaderProps {
  variant?: Variant;
  label?: string;
  className?: string;
}

const LOGO_SRC = "/lovable-uploads/12bdcc4a-a1c8-4ccf-ba6a-931fd566d3c8.png";

function PulsingLogo({ size }: { size: number }) {
  return (
    <img
      src={LOGO_SRC}
      alt=""
      aria-hidden="true"
      className="object-contain select-none"
      style={{
        width: size,
        height: size,
        animation: "loader-pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      }}
    />
  );
}

export function AppLoader({ variant = "panel", label, className }: AppLoaderProps) {
  if (variant === "inline") {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={label ?? "Loading"}
        className={cn("inline-flex items-center justify-center align-middle", className)}
      >
        <PulsingLogo size={24} />
      </span>
    );
  }

  if (variant === "page") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-4 w-full h-full min-h-[70vh] text-center px-6 animate-fade-in",
          className,
        )}
      >
        <PulsingLogo size={60} />
        {label !== "" && (
          <p className="text-sm font-medium text-muted-foreground tracking-wide">
            {label ?? "Loading…"}
          </p>
        )}
      </div>
    );
  }

  // panel
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 w-full h-full min-h-[60vh] animate-fade-in",
        className,
      )}
    >
      <PulsingLogo size={60} />
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
    </div>
  );
}

export default AppLoader;
