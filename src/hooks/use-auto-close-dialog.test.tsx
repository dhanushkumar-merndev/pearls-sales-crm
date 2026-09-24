import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCloseDialog } from "./use-auto-close-dialog";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess },
}));

describe("useAutoCloseDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.refresh.mockClear();
    mocks.toastSuccess.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  it("keeps the dialog open when an action fails", () => {
    const { result, rerender } = renderHook(
      ({ state }) => useAutoCloseDialog(state),
      { initialProps: { state: { ok: false, message: undefined as string | undefined } } },
    );

    act(() => result.current.setOpen(true));
    rerender({ state: { ok: false, message: "Invalid value" } });

    expect(result.current.open).toBe(true);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("closes, refreshes, and toasts after every successful action", () => {
    const { result, rerender } = renderHook(
      ({ state }) => useAutoCloseDialog(state, "Saved."),
      { initialProps: { state: { ok: false, message: undefined as string | undefined } } },
    );

    act(() => result.current.setOpen(true));
    rerender({ state: { ok: true, message: "Updated." } });
    act(() => vi.runAllTimers());

    expect(result.current.open).toBe(false);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Updated.");

    act(() => result.current.setOpen(true));
    rerender({ state: { ok: true, message: undefined } });
    act(() => vi.runAllTimers());

    expect(result.current.open).toBe(false);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenLastCalledWith("Saved.");
  });
});
