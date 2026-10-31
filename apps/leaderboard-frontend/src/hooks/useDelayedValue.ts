// useDelayedValue: shows a new value only `delayMs` after it changed (lap counter: the number
// switches a few seconds after the leader crossed the line, like the Java Swing app).
// The first value and a change of `resetKey` (other race) are shown immediately.

import { useEffect, useRef, useState } from "react";

export function useDelayedValue<T>(value: T, delayMs: number, resetKey: unknown): T {
  const [shown, setShown] = useState(value);
  const key = useRef(resetKey);
  const hadValue = useRef(value !== null && value !== undefined);

  useEffect(() => {
    const immediate = key.current !== resetKey || !hadValue.current || delayMs <= 0;
    key.current = resetKey;
    hadValue.current = value !== null && value !== undefined;
    if (immediate) {
      setShown(value);
      return;
    }
    const timer = setTimeout(() => setShown(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, resetKey]);

  return shown;
}
