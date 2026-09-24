import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/dal";
import { autocompleteApiKey } from "@/lib/env";
import {
  normalizeGeoapifyResponse,
  rankLocationSuggestions,
} from "@/lib/location/geoapify";

const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 160;
const RESULT_LIMIT = 3;

export async function GET(request: NextRequest) {
  await getCurrentProfile();

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ items: [] });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ items: [] }, { status: 400 });
  }

  const apiKey = autocompleteApiKey();
  if (!apiKey) {
    return NextResponse.json({ items: [] }, { status: 503 });
  }

  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.searchParams.set("text", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "en");
  url.searchParams.set("limit", String(RESULT_LIMIT));
  // Prefer Bengaluru/Karnataka and then India without excluding international addresses.
  url.searchParams.set(
    "bias",
    "proximity:77.5946,12.9716|countrycode:in",
  );
  url.searchParams.set("apiKey", apiKey);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return NextResponse.json({ items: [] }, { status: 502 });
    }

    const items = rankLocationSuggestions(
      normalizeGeoapifyResponse(await response.json()),
      query,
    ).slice(0, RESULT_LIMIT);
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch {
    // Autocomplete is an enhancement; callers must remain usable as manual inputs.
    return NextResponse.json({ items: [] }, { status: 503 });
  }
}
