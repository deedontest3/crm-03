// Dedupe wrapper around the legacy useToast and sonner toasts.
// Drops any toast whose (title|description|variant) key has been emitted
// within the last `WINDOW_MS` milliseconds. Prevents duplicate success
// popups when overlapping code paths fire the same toast.

import { toast as legacyToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";

const WINDOW_MS = 1500;
const recent = new Map<string, number>();

function shouldFire(key: string): boolean {
  const now = Date.now();
  // Opportunistic cleanup so the map can't grow unbounded.
  if (recent.size > 64) {
    for (const [k, t] of recent) {
      if (now - t > WINDOW_MS) recent.delete(k);
    }
  }
  const last = recent.get(key);
  if (last && now - last < WINDOW_MS) return false;
  recent.set(key, now);
  return true;
}

type LegacyToastArgs = Parameters<typeof legacyToast>[0];

export function showToastOnce(args: LegacyToastArgs) {
  const key = `legacy|${args.title ?? ""}|${typeof args.description === "string" ? args.description : ""}|${args.variant ?? ""}`;
  if (!shouldFire(key)) return;
  legacyToast(args);
}

export const sonnerOnce = {
  success(msg: string, opts?: Parameters<typeof sonnerToast.success>[1]) {
    if (!shouldFire(`sonner|success|${msg}`)) return;
    sonnerToast.success(msg, opts);
  },
  error(msg: string, opts?: Parameters<typeof sonnerToast.error>[1]) {
    if (!shouldFire(`sonner|error|${msg}`)) return;
    sonnerToast.error(msg, opts);
  },
  warning(msg: string, opts?: Parameters<typeof sonnerToast.warning>[1]) {
    if (!shouldFire(`sonner|warning|${msg}`)) return;
    sonnerToast.warning(msg, opts);
  },
  info(msg: string, opts?: Parameters<typeof sonnerToast.info>[1]) {
    if (!shouldFire(`sonner|info|${msg}`)) return;
    sonnerToast.info(msg, opts);
  },
};
