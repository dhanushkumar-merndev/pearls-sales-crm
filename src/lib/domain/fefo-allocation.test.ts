import { describe, expect, it } from "vitest";
import { allocateFefoStock, type FefoBatch } from "./fefo-allocation";

const batches: FefoBatch[] = [
  {
    id: "early",
    medicineId: "medicine",
    batchNumber: "A",
    expiry: "2027-01-01",
    quantity: 5,
    pricePaise: 1000,
    unitsPerPack: 10,
  },
  {
    id: "later",
    medicineId: "medicine",
    batchNumber: "B",
    expiry: "2028-01-01",
    quantity: 10,
    pricePaise: 1200,
    unitsPerPack: 10,
  },
];

const request = (selectedQuantity: number, preferredBatchId: string | null = null) => ({
  itemId: "item",
  medicineId: "medicine",
  requestedQuantity: 8,
  selectedQuantity,
  preferredBatchId,
});

describe("allocateFefoStock", () => {
  it("adds batch availability and splits one dispense in FEFO order", () => {
    expect(allocateFefoStock([request(8)], batches)).toEqual([
      {
        availableNow: 15,
        selectedQuantity: 8,
        notSuppliedQuantity: 0,
        excessQuantity: 0,
        batches: [
          { batchId: "early", quantity: 5 },
          { batchId: "later", quantity: 3 },
        ],
      },
    ]);
  });

  it("lets the pharmacist put another valid batch first", () => {
    expect(allocateFefoStock([request(8, "later")], batches)[0].batches).toEqual([
      { batchId: "later", quantity: 8 },
    ]);
  });

  it("keeps a real shortage pending after adding every batch", () => {
    const result = allocateFefoStock(
      [{ ...request(20), requestedQuantity: 20 }],
      batches,
    )[0];
    expect(result).toMatchObject({
      availableNow: 15,
      selectedQuantity: 15,
      notSuppliedQuantity: 5,
    });
  });

  it("recalculates stock increases and decreases from the latest batch list", () => {
    expect(allocateFefoStock([request(8)], batches.slice(0, 1))[0].selectedQuantity).toBe(5);
    expect(allocateFefoStock([request(8)], batches)[0].selectedQuantity).toBe(8);
    expect(
      allocateFefoStock(
        [request(8)],
        batches.map((batch) => ({ ...batch, quantity: 1 })),
      )[0].selectedQuantity,
    ).toBe(2);
  });

  it("does not allocate the same physical stock to duplicate prescription rows", () => {
    const result = allocateFefoStock(
      [
        { ...request(8), itemId: "first" },
        { ...request(8), itemId: "second" },
      ],
      batches,
    );
    expect(result.map((line) => line.selectedQuantity)).toEqual([8, 7]);
    expect(result[1].notSuppliedQuantity).toBe(1);
  });

  it("allows an audited excess only up to combined physical stock", () => {
    const result = allocateFefoStock(
      [request(99)],
      batches,
      { allowExceedingRequest: true },
    )[0];
    expect(result).toMatchObject({
      availableNow: 15,
      selectedQuantity: 15,
      excessQuantity: 7,
    });
  });
});
