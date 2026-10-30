// useStoredState: useState persisted in localStorage (per device), tolerant of missing storage.

import { useEffect, useState } from "react";

export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable: keep in memory only
    }
  }, [key, value]);
  return [value, setValue];
}
