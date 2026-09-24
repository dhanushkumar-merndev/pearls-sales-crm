"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Realtime pushes invalidations the moment data changes, so cached
            // data does not need a short staleness window. At 20s, every tab
            // switch refetched and every refocus hit the server again; 5
            // minutes keeps the UI just as fresh while cutting idle traffic.
            staleTime: 5 * 60_000,
            gcTime: 10 * 60_000,
            // Staff alt-tab constantly between the queue and a patient record.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
