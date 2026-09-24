import { WifiOff } from "lucide-react";
import Image from "next/image";
import { OfflineRetryButton } from "@/components/shared/offline-retry-button";

// Shown by the service worker when a page was never visited before going
// offline (so nothing was cached for it), instead of the browser's own
// "no internet" screen. Deliberately has no data dependency of its own --
// it must render from the cache alone, with no network and no auth check.
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
      <Image src="/logo-mark.png" alt="Pearl Aesthetic & Wellness Clinic" width={56} height={56} />
      <div className="flex items-center gap-2 text-muted-foreground">
        <WifiOff className="size-5" />
        <p className="text-sm font-medium">You&apos;re offline</p>
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-lg font-semibold">This page hasn&apos;t been saved yet</p>
        <p className="text-sm text-muted-foreground">
          Pages you&apos;ve already opened stay available offline. This one
          hasn&apos;t been visited yet, so it needs a connection the first time.
        </p>
      </div>
      <OfflineRetryButton />
    </main>
  );
}
