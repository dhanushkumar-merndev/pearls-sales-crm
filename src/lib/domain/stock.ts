export function stockStatus(quantity: number, lowStockThreshold: number) {
  if (quantity <= 0) return "out_of_stock" as const;
  if (quantity <= lowStockThreshold) return "low_stock" as const;
  return "in_stock" as const;
}

export function remainingPrescriptionQuantity(requested: number, dispensed: number) {
  if (requested < 0 || dispensed < 0 || dispensed > requested) {
    throw new Error("Dispensed quantity must be between zero and requested quantity.");
  }
  return requested - dispensed;
}
