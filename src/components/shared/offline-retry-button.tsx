"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OfflineRetryButton() {
  return (
    <Button onClick={() => window.location.reload()}>
      <RefreshCw /> Try again
    </Button>
  );
}
