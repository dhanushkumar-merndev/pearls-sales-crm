"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Alert variant="destructive"><AlertTriangle /><AlertTitle>We could not load this page</AlertTitle><AlertDescription className="mt-2">Try again. If the issue continues, contact the administrator.<div className="mt-4"><Button variant="outline" onClick={reset}><RotateCcw /> Retry</Button></div></AlertDescription></Alert>;
}
