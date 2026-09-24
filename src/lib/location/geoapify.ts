import type { LocationSuggestion } from "@/types/location";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeGeoapifyResponse(value: unknown): LocationSuggestion[] {
  const root = record(value);
  const results = root && Array.isArray(root.results) ? root.results : [];
  const seen = new Set<string>();

  return results.flatMap((candidate) => {
    const item = record(candidate);
    if (!item) return [];

    const address = optionalString(item.formatted);
    if (!address) return [];

    const placeId = optionalString(item.place_id);
    const latitude = optionalNumber(item.lat);
    const longitude = optionalNumber(item.lon);
    const identity = placeId ?? `${address}|${latitude ?? ""}|${longitude ?? ""}`;
    if (seen.has(identity)) return [];
    seen.add(identity);

    const primaryText =
      optionalString(item.name) ??
      optionalString(item.address_line1) ??
      optionalString(item.city) ??
      address.split(",")[0]?.trim() ??
      address;

    return [
      {
        address,
        latitude,
        longitude,
        city: optionalString(item.city),
        state: optionalString(item.state),
        country: optionalString(item.country),
        postcode: optionalString(item.postcode),
        placeId,
        locationSource: "geoapify" as const,
        primaryText,
        secondaryText: primaryText === address ? null : address,
      },
    ];
  });
}

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-IN")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function relevanceScore(item: LocationSuggestion, query: string) {
  const normalizedQuery = normalized(query);
  let score = 0;

  if (item.postcode && normalizedQuery.includes(normalized(item.postcode))) {
    score += 400;
  }
  if (item.state && normalizedQuery.includes(normalized(item.state))) {
    score += 300;
  }

  const city = item.city ? normalized(item.city) : "";
  const cityAliases = city === "bengaluru" ? ["bengaluru", "bangalore"] : [city];
  if (city && cityAliases.some((alias) => normalizedQuery.includes(alias))) {
    score += 200;
  }

  const queryTokens = new Set(normalizedQuery.split(" ").filter((token) => token.length > 2));
  const addressTokens = new Set(normalized(item.address).split(" "));
  for (const token of queryTokens) {
    if (addressTokens.has(token)) score += 5;
  }

  return score;
}

export function rankLocationSuggestions(
  items: LocationSuggestion[],
  query: string,
) {
  return items
    .map((item, index) => ({ item, index, score: relevanceScore(item, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
}
