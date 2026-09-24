import { describe, expect, it } from "vitest";
import {
  normalizeGeoapifyResponse,
  rankLocationSuggestions,
} from "./geoapify";

describe("normalizeGeoapifyResponse", () => {
  it("maps structured Geoapify data and ignores malformed or duplicate rows", () => {
    const items = normalizeGeoapifyResponse({
      results: [
        {
          formatted: "Indiranagar, Bengaluru, Karnataka, India",
          name: "Indiranagar",
          city: "Bengaluru",
          state: "Karnataka",
          country: "India",
          postcode: "560038",
          lat: 12.9784,
          lon: 77.6408,
          place_id: "geo-place-1",
        },
        {
          formatted: "Indiranagar duplicate",
          place_id: "geo-place-1",
        },
        { name: "Missing formatted address" },
      ],
    });

    expect(items).toEqual([
      {
        address: "Indiranagar, Bengaluru, Karnataka, India",
        latitude: 12.9784,
        longitude: 77.6408,
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postcode: "560038",
        placeId: "geo-place-1",
        locationSource: "geoapify",
        primaryText: "Indiranagar",
        secondaryText: "Indiranagar, Bengaluru, Karnataka, India",
      },
    ]);
  });

  it("returns an empty list for an unexpected upstream payload", () => {
    expect(normalizeGeoapifyResponse({ error: "rate limited" })).toEqual([]);
    expect(normalizeGeoapifyResponse(null)).toEqual([]);
  });

  it("orders typed Karnataka, Bengaluru and postcode matches first", () => {
    const items = normalizeGeoapifyResponse({
      results: [
        {
          formatted: "6 Sangam Road, Chennai, Tamil Nadu 600001, India",
          city: "Chennai",
          state: "Tamil Nadu",
          postcode: "600001",
          place_id: "tamil-nadu-result",
        },
        {
          formatted: "6 Sangam Road, Bengaluru, Karnataka 560042, India",
          city: "Bengaluru",
          state: "Karnataka",
          postcode: "560042",
          place_id: "karnataka-result",
        },
      ],
    });

    const ranked = rankLocationSuggestions(
      items,
      "6 Sangam Road, Bangalore, Karnataka 560042",
    );

    expect(ranked.map((item) => item.placeId)).toEqual([
      "karnataka-result",
      "tamil-nadu-result",
    ]);
  });
});
