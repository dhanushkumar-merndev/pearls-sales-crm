import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";
  // /offline is the service worker's fallback for a page that was never
  // cached -- it must render with no session and no network, exactly like
  // /login and /setup already do.
  const isProtected =
    !isLogin && path !== "/" && path !== "/offline" && !path.startsWith("/setup");

  if (isProtected && !data?.claims) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  if (isLogin && data?.claims) {
    // Claims can remain valid in the browser briefly after an Auth user is
    // deleted (for example after a database reset). Verify the user before
    // redirecting or /login and /dashboard will redirect to each other.
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = "/dashboard";
      dashboardUrl.search = "";
      return NextResponse.redirect(dashboardUrl);
    }
    await supabase.auth.signOut({ scope: "local" });
  }

  return response;
}
