import "server-only";

// WHO's official ICD-10 (2019) classification -- the same base system your
// insurance claims are written against, as opposed to the US ICD-10-CM
// clinical modification. Optional: entirely inert unless the hospital has
// registered its own free client credentials at icd.who.int/icdapi and set
// WHOS_CLIENT / WHOS_SECRET. Nothing here is bundled or redistributed -- every
// call goes live to WHO's servers with the hospital's own credentials.
//
// IMPORTANT: WHO's current (v2) ICD-API has no free-text search for ICD-10 --
// only for the ICD-11 Foundation, and for ICD-10 direct lookup-by-code
// (confirmed live against a real account; the v1 text-search endpoint this
// module originally called is dead -- 404, "deprecated"). So this can only
// ever resolve an *exact* ICD-10 code the doctor already typed (e.g.
// "E11.9"), not a word search like "diabetes" -- that gap is instead covered
// by bulk-loading WHO's category-level codes once (see the
// 20260819110000_who_icd10_category_seed migration and its crawl script)
// rather than a per-keystroke API call that does not exist.
const TOKEN_URL = "https://icdaccessmanagement.who.int/connect/token";
const RELEASE_BASE = "https://id.who.int/icd/release/10/2019";
const REQUEST_TIMEOUT_MS = 5000;
// WHO category/subcategory codes: a letter, two digits, optional .digits
// (A00, E11, E11.9, ...). Anything else is a word search, which this API
// cannot do for ICD-10.
const CODE_PATTERN = /^[A-Za-z]\d{2}(\.\d+)?$/;

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.WHOS_CLIENT;
  const clientSecret = process.env.WHOS_SECRET;
  if (!clientId || !clientSecret) return null;

  // Tokens are valid ~1 hour; refresh a little early rather than racing
  // expiry mid-request.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "icdapi_access",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) return null;
    cachedToken = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  } catch {
    return null;
  }
}

export type WhoIcd10Result = {
  display_text: string;
  code: string;
  code_system: "ICD-10";
};

/**
 * Looks up an exact ICD-10 code against WHO's live release API. Only reached
 * from the search route when the local clinical_terms directory has nothing
 * for this query and the query itself looks like a code (a free-text word
 * search has no WHO endpoint to fall back to -- see the module comment
 * above). The result is meant to be cached back into clinical_terms (see
 * cache_who_icd10_term) so the same code is a database hit next time and
 * this network call is never repeated for it.
 *
 * Fails silently (empty array) on any error -- missing credentials, a WHO
 * outage, an unrecognised code, a bad response shape -- a diagnosis search
 * must never hard-fail because an optional external lookup did not come
 * back.
 */
export async function searchWhoIcd10(query: string): Promise<WhoIcd10Result[]> {
  const code = query.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) return [];
  try {
    const token = await getAccessToken();
    if (!token) return [];

    const response = await fetch(`${RELEASE_BASE}/${code}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "API-Version": "v2",
        "Accept-Language": "en",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return [];

    const body = (await response.json()) as {
      code?: string;
      title?: { "@value"?: string };
    };
    const title = body.title?.["@value"]?.trim();
    if (!body.code || !title) return [];
    return [{ display_text: title, code: body.code, code_system: "ICD-10" }];
  } catch {
    return [];
  }
}
