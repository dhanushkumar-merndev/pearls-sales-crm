import { z } from "zod";

// PostgreSQL's uuid type accepts all hexadecimal UUID layouts. Zod's z.uuid()
// intentionally enforces RFC version/variant bits, which is too restrictive for
// deterministic UUIDs used by imports and legacy hospital records.
export const databaseIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid database ID",
  );
