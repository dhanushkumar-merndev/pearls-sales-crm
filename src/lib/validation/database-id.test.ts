import { describe, expect, it } from "vitest";
import { databaseIdSchema } from "./database-id";

describe("databaseIdSchema", () => {
  it("accepts PostgreSQL UUID values regardless of RFC variant bits", () => {
    expect(
      databaseIdSchema.parse("e55ca1dd-e2e3-6183-c780-570363a4d99a"),
    ).toBe("e55ca1dd-e2e3-6183-c780-570363a4d99a");
  });

  it("rejects malformed identifiers", () => {
    expect(databaseIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
