import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // sw.js and the web manifest are infrastructure files the browser (and
    // the PWA install/offline machinery) fetches with no session context --
    // same category as favicon.ico, not an app page.
    "/((?!api/health(?:/|$)|api/webhooks/meta(?:/|$)|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
