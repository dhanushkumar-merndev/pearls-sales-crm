"use client";

import { useEffect, useState } from "react";
import { formatWaitingTime } from "@/lib/domain/date";

/**
 * How long a patient has been waiting, kept live.
 *
 * The queue is a server component, so its waiting times were calculated once at
 * render and then frozen -- a screen left open at the OP desk kept showing the
 * figure from whenever the page last loaded, which read as a wrong number
 * rather than a stale one. This re-renders from the browser clock every 30s.
 *
 * The first paint uses the server's value so the markup matches during
 * hydration; the clock takes over immediately after mount.
 */
export function ElapsedTime({ since }: { since: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // The clock is the external event this component follows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="tabular-nums" suppressHydrationWarning>
      {formatWaitingTime(since, now ?? undefined)}
    </span>
  );
}
