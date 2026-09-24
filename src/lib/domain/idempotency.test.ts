import { describe, expect, it } from "vitest";
import { isIdempotentReplay } from "./idempotency";

describe("isIdempotentReplay", () => {
  it("treats a repeat of the same idempotency key as already saved", () => {
    expect(
      isIdempotentReplay({
        code: "23505",
        message: 'duplicate key value violates unique constraint "visit_payments_idempotency_key_key"',
      }),
    ).toBe(true);
  });

  it("does not swallow a different unique violation", () => {
    // A real conflict on another unique column must still surface as an error.
    expect(
      isIdempotentReplay({
        code: "23505",
        message: 'duplicate key value violates unique constraint "pharmacy_sale_items_sale_id_prescription_item_id_key"',
      }),
    ).toBe(false);
  });

  it("ignores non-unique errors and no error at all", () => {
    expect(isIdempotentReplay({ code: "23514", message: "check constraint" })).toBe(false);
    expect(isIdempotentReplay(null)).toBe(false);
  });
});
