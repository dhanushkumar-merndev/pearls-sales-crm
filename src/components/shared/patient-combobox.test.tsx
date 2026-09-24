import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PatientCombobox } from "./patient-combobox";

describe("PatientCombobox", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not preload patients and searches only after a debounced query", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "patient-1",
            name: "Akhil Anand",
            phone_normalized: "7000008395",
          },
        ],
      }),
    });

    render(<PatientCombobox value={null} onChange={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Search patient by phone or name",
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const input = screen.getByPlaceholderText("Type phone number or patient name");
    fireEvent.change(input, { target: { value: "7" } });
    act(() => vi.advanceTimersByTime(400));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "70" } });
    act(() => vi.advanceTimersByTime(499));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search/patients?q=70",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText("Akhil Anand")).toBeInTheDocument();
    expect(screen.getByText("7000008395")).toBeInTheDocument();
  });
});
