import { describe, expect, it } from "vitest";
import { formatWaitingTime } from "./date";

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 7, 16, 12, 0, 0) - minutesAgo * 60_000).toISOString();
const now = new Date(Date.UTC(2026, 7, 16, 12, 0, 0));

describe("formatWaitingTime", () => {
  it("reads as words instead of raw minutes", () => {
    expect(formatWaitingTime(at(0), now)).toBe("just now");
    expect(formatWaitingTime(at(1), now)).toBe("1 min");
    expect(formatWaitingTime(at(29), now)).toBe("29 min");
    expect(formatWaitingTime(at(59), now)).toBe("59 min");
    // 158 min used to print as "158 min" and left the reader doing the maths.
    expect(formatWaitingTime(at(158), now)).toBe("2 h 38 m");
    expect(formatWaitingTime(at(120), now)).toBe("2 h");
    expect(formatWaitingTime(at(24 * 60), now)).toBe("1 d");
    expect(formatWaitingTime(at(28 * 60), now)).toBe("1 d 4 h");
  });

  it("is a plain elapsed duration, so the stored zone does not matter", () => {
    // The same instant written in UTC and in IST must give the same answer.
    const utc = "2026-08-16T09:00:00+00:00";
    const ist = "2026-08-16T14:30:00+05:30";
    const reference = new Date("2026-08-16T09:30:00Z");
    expect(formatWaitingTime(utc, reference)).toBe("30 min");
    expect(formatWaitingTime(ist, reference)).toBe(formatWaitingTime(utc, reference));
  });

  it("never shows negative time for a clock that is slightly ahead", () => {
    expect(formatWaitingTime(at(-2), now)).toBe("just now");
  });
});
