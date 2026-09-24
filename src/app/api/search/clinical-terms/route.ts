import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchWhoIcd10 } from "@/lib/search/who-icd10";

const TERM_TYPES = ["diagnosis", "symptom", "investigation", "advice"];

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!["admin", "doctor", "reception", "pharmacy"].includes(profile.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const type = request.nextUrl.searchParams.get("type") ?? "diagnosis";
  if (!TERM_TYPES.includes(type))
    return NextResponse.json({ error: "Unknown term type" }, { status: 400 });

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const codeSystem = request.nextUrl.searchParams.get("codeSystem")?.trim() ?? "";
  if (codeSystem && !["ICD-10", "SNOMED-CT"].includes(codeSystem))
    return NextResponse.json({ error: "Unknown code system" }, { status: 400 });
  if (codeSystem && !["admin", "doctor", "pharmacy"].includes(profile.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (q.length < 2) return NextResponse.json({ items: [] });
  if (q.length > 120)
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data, error } =
    type === "diagnosis" && codeSystem
      ? await supabase.rpc("search_diagnosis_terms", {
          p_query: q,
          p_code_system: codeSystem,
          p_limit: 20,
        })
      : await supabase.rpc("search_clinical_terms", {
          p_term_type: type,
          p_query: q,
          p_limit: 20,
        });
  if (error) return NextResponse.json({ error: "Search unavailable" }, { status: 500 });

  let items = data ?? [];
  // WHO's ICD-10 API is a fallback for a gap in the local directory, not a
  // replacement for it: only reached when the local search found nothing,
  // and only for diagnoses (that's all WHO ICD-10 covers here). Inert unless
  // the hospital has registered WHOS_CLIENT/WHOS_SECRET -- see who-icd10.ts.
  // Note this only ever resolves an exact code (e.g. "E11.9") -- WHO has no
  // free-text ICD-10 search endpoint, so a word query that misses locally
  // stays missed; searchWhoIcd10 itself no-ops for anything code-shaped.
  if (
    type === "diagnosis" &&
    (!codeSystem || codeSystem === "ICD-10") &&
    items.length === 0 &&
    q.length >= 3
  ) {
    const whoResults = await searchWhoIcd10(q);
    if (whoResults.length) {
      items = whoResults;
      // Cache each match into clinical_terms so the same query is a
      // database hit next time and never reaches WHO's API again for it.
      // Awaited (not fire-and-forget): a serverless route handler can be
      // torn down the moment the response is sent, which would silently
      // drop an un-awaited write. Best-effort -- a caching failure must
      // never turn a successful search into a failed one.
      await Promise.allSettled(
        whoResults.map((item) =>
          supabase.rpc("cache_who_icd10_term", {
            p_display_text: item.display_text,
            p_code: item.code,
          }),
        ),
      );
    }
  }

  return NextResponse.json(
    { items },
    {
      // Clinical directory entries are non-patient reference data. A short
      // browser-private cache avoids repeating the exact same code/text query
      // while keeping admin edits visible quickly.
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
