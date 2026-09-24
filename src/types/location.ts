export type LocationSource = "geoapify" | "manual";

export type LocationDetails = {
  address: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
  placeId: string | null;
  locationSource: LocationSource;
};

export type LocationSuggestion = LocationDetails & {
  locationSource: "geoapify";
  primaryText: string;
  secondaryText: string | null;
};
