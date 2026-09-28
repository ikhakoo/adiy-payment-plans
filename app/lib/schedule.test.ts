import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildSchedule,
  nextRetryDate,
  respread,
  toCents,
} from "./schedule";

const sum = (xs: { amountCents: number }[]) =>
  xs.reduce((s, x) => s + x.amountCents, 0);

describe("buildSchedule", () => {
  it("splits the outstanding balance evenly across the remaining months", () => {
    const s = buildSchedule({
      checkoutPaidCents: 250000,
      outstandingCents: 750000,
      count: 4,
      startDate: new Date("2026-10-01T00:00:00Z"),
    });
    expect(s.map((i) => i.amountCents)).toEqual([250000, 250000, 250000, 250000]);
    expect(s.map((i) => i.dueDate.toISOString().slice(0, 10))).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });

  it("puts leftover cents on the last installment so the total is exact", () => {
    const s = buildSchedule({
      checkoutPaidCents: 166700,
      outstandingCents: 833333,
      count: 6,
      startDate: new Date("2026-10-15T00:00:00Z"),
    });
    expect(s.slice(1, 5).every((i) => i.amountCents === 166666)).toBe(true);
    expect(s[5].amountCents).toBe(166669);
    expect(sum(s.slice(1))).toBe(833333);
  });

  it("rejects a single-payment plan", () => {
    expect(() =>
      buildSchedule({
        checkoutPaidCents: 1,
        outstandingCents: 1,
        count: 1,
        startDate: new Date(),
      }),
    ).toThrow();
  });
});

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths(new Date("2027-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(addMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });
});

describe("respread", () => {
  it("re-splits a changed balance over unpaid installments", () => {
    const unpaid = [
      { seq: 3, dueDate: new Date("2026-12-01") },
      { seq: 4, dueDate: new Date("2027-01-01") },
    ];
    const r = respread(unpaid, 100001);
    expect(r.map((i) => i.amountCents)).toEqual([50000, 50001]);
    expect(r.map((i) => i.seq)).toEqual([3, 4]);
  });
});

describe("nextRetryDate", () => {
  it("follows the retry schedule, then gives up", () => {
    const t = new Date("2026-10-01T12:00:00Z");
    expect(nextRetryDate(t, 1, [3, 7])?.toISOString()).toBe(
      "2026-10-04T12:00:00.000Z",
    );
    expect(nextRetryDate(t, 2, [3, 7])?.toISOString()).toBe(
      "2026-10-08T12:00:00.000Z",
    );
    expect(nextRetryDate(t, 3, [3, 7])).toBeNull();
  });
});

describe("toCents", () => {
  it("avoids float drift", () => {
    expect(toCents("19.99")).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});
