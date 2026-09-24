import { describe, expect, it } from "vitest";
import { allocateVisibleStock } from "./stock-allocation";

const EXCESS = { allowExceedingRequest: true };

describe("allocateVisibleStock", () => {
  it("caps rows that choose the same stock source without reserving it", () => {
    expect(
      allocateVisibleStock(
        [
          { stockKey: "batch-a", requestedQuantity: 6, selectedQuantity: 6 },
          { stockKey: "batch-a", requestedQuantity: 5, selectedQuantity: 5 },
        ],
        { "batch-a": 8 },
      ),
    ).toEqual([
      {
        availableNow: 8,
        selectedQuantity: 6,
        notSuppliedQuantity: 0,
        excessQuantity: 0,
      },
      {
        availableNow: 2,
        selectedQuantity: 2,
        notSuppliedQuantity: 3,
        excessQuantity: 0,
      },
    ]);
  });

  it("keeps explicit manual lines out of stock allocation", () => {
    expect(
      allocateVisibleStock(
        [{ stockKey: null, requestedQuantity: 4, selectedQuantity: 4 }],
        {},
      ),
    ).toEqual([
      {
        availableNow: null,
        selectedQuantity: 4,
        notSuppliedQuantity: 0,
        excessQuantity: 0,
      },
    ]);
  });

  it("normalizes invalid quantities to a safe requested/supplied split", () => {
    expect(
      allocateVisibleStock(
        [{ stockKey: "batch-a", requestedQuantity: 3.8, selectedQuantity: 9 }],
        { "batch-a": 2.9 },
      ),
    ).toEqual([
      {
        availableNow: 2,
        selectedQuantity: 2,
        notSuppliedQuantity: 1,
        excessQuantity: 0,
      },
    ]);
  });

  it("caps to visible stock, not to the request, when excess is allowed", () => {
    expect(
      allocateVisibleStock(
        [{ stockKey: "batch-a", requestedQuantity: 6, selectedQuantity: 99 }],
        { "batch-a": 188 },
        EXCESS,
      ),
    ).toEqual([
      {
        availableNow: 188,
        selectedQuantity: 99,
        notSuppliedQuantity: 0,
        excessQuantity: 93,
      },
    ]);
  });

  it("still refuses to promise more than the stock actually visible", () => {
    expect(
      allocateVisibleStock(
        [{ stockKey: "batch-a", requestedQuantity: 6, selectedQuantity: 99 }],
        { "batch-a": 40 },
        EXCESS,
      ),
    ).toEqual([
      {
        availableNow: 40,
        selectedQuantity: 40,
        notSuppliedQuantity: 0,
        excessQuantity: 34,
      },
    ]);
  });

  it("shares one batch across rows even when each row may exceed its request", () => {
    expect(
      allocateVisibleStock(
        [
          { stockKey: "batch-a", requestedQuantity: 2, selectedQuantity: 30 },
          { stockKey: "batch-a", requestedQuantity: 2, selectedQuantity: 30 },
        ],
        { "batch-a": 50 },
        EXCESS,
      ),
    ).toEqual([
      {
        availableNow: 50,
        selectedQuantity: 30,
        notSuppliedQuantity: 0,
        excessQuantity: 28,
      },
      {
        availableNow: 20,
        selectedQuantity: 20,
        notSuppliedQuantity: 0,
        excessQuantity: 18,
      },
    ]);
  });

  it("leaves a short supply pending rather than reporting it as excess", () => {
    expect(
      allocateVisibleStock(
        [{ stockKey: "batch-a", requestedQuantity: 10, selectedQuantity: 4 }],
        { "batch-a": 188 },
        EXCESS,
      ),
    ).toEqual([
      {
        availableNow: 188,
        selectedQuantity: 4,
        notSuppliedQuantity: 6,
        excessQuantity: 0,
      },
    ]);
  });
});
