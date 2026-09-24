/**
 * Shared by the medicines page (a Server Component) and the dialog (a Client
 * Component), so it deliberately lives in a module with no "use client":
 * importing a plain value out of a client module gives the server a client
 * reference proxy rather than the object itself, and the arrays arrive on the
 * client as undefined.
 */
export type MedicineFieldOptions = {
  dosage_form: string[];
  manufacturer: string[];
  generic_name: string[];
  strength: string[];
};

/** A fresh, independently mutable set of empty lists. */
export function emptyFieldOptions(): MedicineFieldOptions {
  return { dosage_form: [], manufacturer: [], generic_name: [], strength: [] };
}

/** Buckets `get_medicine_field_options` rows by field, in the order returned. */
export function groupFieldOptions(
  rows: Array<{ field: string; value: string }> | null | undefined,
): MedicineFieldOptions {
  const grouped = emptyFieldOptions();
  for (const row of rows ?? []) {
    const bucket = grouped[row.field as keyof MedicineFieldOptions];
    if (bucket) bucket.push(row.value);
  }
  return grouped;
}
