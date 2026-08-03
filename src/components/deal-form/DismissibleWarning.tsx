import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";

interface DismissibleWarningProps {
  storageKey: string;
  message: string;
}

export const DismissibleWarning = ({ storageKey, message }: DismissibleWarningProps) => {
  const fullKey = `warn-dismissed:${storageKey}:${message}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && localStorage.getItem(fullKey) === "1") {
        setDismissed(true);
      } else {
        setDismissed(false);
      }
    } catch {
      /* ignore */
    }
  }, [fullKey]);

  if (dismissed) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors"
        onClick={() => {
          try {
            localStorage.setItem(fullKey, "1");
          } catch {
            /* ignore */
          }
          setDismissed(true);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
