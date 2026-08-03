import { Dispatch, SetStateAction, useEffect, useState } from "react";

/**
 * Same signature as useState, but reads the initial value from localStorage
 * (falling back to `defaultValue`) and writes to localStorage on every change.
 * Safe in SSR/tests where `window` is undefined.
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  sanitize?: (v: T) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return defaultValue;
      const parsed = JSON.parse(raw) as T;
      return sanitize ? sanitize(parsed) : parsed;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota / private mode — ignore */
    }
  }, [key, state]);

  return [state, setState];
}
