import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationAutocomplete } from "./location-autocomplete";

describe("LocationAutocomplete", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("debounces search and supports keyboard selection", async () => {
    const onChange = vi.fn();
    const onLocationSelect = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
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
        ],
      }),
    });

    render(
      <LocationAutocomplete
        aria-label="Address"
        onChange={onChange}
        onLocationSelect={onLocationSelect}
      />,
    );
    const field = screen.getByRole("combobox", { name: "Address" });
    fireEvent.focus(field);

    fireEvent.change(field, { target: { value: "In" } });
    act(() => vi.advanceTimersByTime(500));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "Ind" } });
    act(() => vi.advanceTimersByTime(499));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search/locations?q=Ind",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole("option", { name: /Indiranagar/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).toHaveValue("Ind");
    expect(onLocationSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: "Ind",
        locationSource: "manual",
        latitude: null,
        longitude: null,
      }),
    );

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Indiranagar/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).toHaveValue("Indiranagar, Bengaluru, Karnataka, India");
    expect(onLocationSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        locationSource: "geoapify",
        latitude: 12.9784,
        longitude: 77.6408,
      }),
    );

    fireEvent.change(field, {
      target: { value: "Indiranagar near Metro Gate 2" },
    });
    expect(onLocationSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: "Indiranagar near Metro Gate 2",
        locationSource: "manual",
        latitude: null,
        longitude: null,
        placeId: null,
      }),
    );
  });

  it("keeps custom text valid without requiring a suggestion", () => {
    const onLocationSelect = vi.fn();
    const { container } = render(
      <form>
        <LocationAutocomplete
          aria-label="Address"
          name="address"
          onLocationSelect={onLocationSelect}
        />
      </form>,
    );
    const field = screen.getByRole("combobox", { name: "Address" });
    fireEvent.focus(field);
    const manualAddress = "Near Ravi Bakery, opposite main gate";

    fireEvent.change(field, { target: { value: manualAddress } });

    expect(field).toHaveValue(manualAddress);
    expect(new FormData(container.querySelector("form")!).get("address")).toBe(
      manualAddress,
    );
    expect(onLocationSelect).toHaveBeenLastCalledWith({
      address: manualAddress,
      latitude: null,
      longitude: null,
      city: null,
      state: null,
      country: null,
      postcode: null,
      placeId: null,
      locationSource: "manual",
    });
  });
});
