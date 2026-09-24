export type FefoBatch = {
  id: string;
  medicineId: string;
  batchNumber: string;
  expiry: string;
  quantity: number;
  pricePaise: number;
  unitsPerPack: number;
};

export type FefoRequestLine = {
  itemId: string;
  medicineId: string | null;
  requestedQuantity: number;
  selectedQuantity: number;
  /** Optional pharmacist override. This batch is used first, then FEFO resumes. */
  preferredBatchId: string | null;
};

export type FefoBatchAllocation = {
  batchId: string;
  quantity: number;
};

export type FefoAllocation = {
  availableNow: number;
  selectedQuantity: number;
  notSuppliedQuantity: number;
  excessQuantity: number;
  batches: FefoBatchAllocation[];
};

function wholeNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function compareFefo(a: FefoBatch, b: FefoBatch) {
  return (
    a.expiry.localeCompare(b.expiry) ||
    a.batchNumber.localeCompare(b.batchNumber) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Splits each requested total across live batches. The earliest expiry wins by
 * default; a pharmacist may put one valid batch first, after which FEFO order
 * resumes. Remaining stock is shared across duplicate prescription rows, so
 * the UI can never promise the same units twice.
 */
export function allocateFefoStock(
  lines: readonly FefoRequestLine[],
  batches: readonly FefoBatch[],
  options: { allowExceedingRequest?: boolean } = {},
): FefoAllocation[] {
  const remaining = new Map(
    batches.map((batch) => [batch.id, wholeNonNegative(batch.quantity)]),
  );
  const allowExcess = options.allowExceedingRequest === true;

  return lines.map((line) => {
    const requested = wholeNonNegative(line.requestedQuantity);
    const desired = wholeNonNegative(line.selectedQuantity);
    const eligible = batches
      .filter(
        (batch) =>
          line.medicineId !== null &&
          batch.medicineId === line.medicineId &&
          (remaining.get(batch.id) ?? 0) > 0,
      )
      .sort((a, b) => {
        if (a.id === line.preferredBatchId) return -1;
        if (b.id === line.preferredBatchId) return 1;
        return compareFefo(a, b);
      });
    const availableNow = eligible.reduce(
      (sum, batch) => sum + (remaining.get(batch.id) ?? 0),
      0,
    );
    const selectedQuantity = Math.min(
      allowExcess ? desired : Math.min(desired, requested),
      availableNow,
    );
    let needed = selectedQuantity;
    const allocations: FefoBatchAllocation[] = [];

    for (const batch of eligible) {
      if (needed === 0) break;
      const batchRemaining = remaining.get(batch.id) ?? 0;
      const quantity = Math.min(needed, batchRemaining);
      if (quantity > 0) {
        allocations.push({ batchId: batch.id, quantity });
        remaining.set(batch.id, batchRemaining - quantity);
        needed -= quantity;
      }
    }

    return {
      availableNow,
      selectedQuantity,
      notSuppliedQuantity: Math.max(0, requested - selectedQuantity),
      excessQuantity: Math.max(0, selectedQuantity - requested),
      batches: allocations,
    };
  });
}
