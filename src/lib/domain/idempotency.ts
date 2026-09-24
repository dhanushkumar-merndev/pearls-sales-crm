/**
 * A retried submit (double click, flaky network, refresh) re-sends the same
 * idempotency key, and the unique index on that column rejects the second
 * insert. That is a success from the user's point of view: the row is already
 * there.
 *
 * Any OTHER unique violation is a real failure and must not be reported as
 * "already recorded" -- doing so silently discards a genuinely new record.
 */
export function isIdempotentReplay(error: { code?: string; message?: string; details?: string } | null) {
  if (!error || error.code !== "23505") return false;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return text.includes("idempotency_key");
}
