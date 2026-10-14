import { describe, expect, it } from "vitest";
import { carrierTrackingUrl, deckProgress, partsGuarantee, workingDays, type TrackableOrder } from "./tracking";

// Mon 2026-10-05 10:00 ET
const ordered = "2026-10-05T14:00:00Z";
const at = (iso: string) => new Date(iso);
const order = (over: Partial<TrackableOrder> = {}): TrackableOrder => ({
  name: "#212481885",
  createdAt: ordered,
  displayFulfillmentStatus: "UNFULFILLED",
  fulfillments: [],
  ...over,
});

describe("workingDays", () => {
  it("counts both ends and skips weekends", () => {
    expect(workingDays(at(ordered), at("2026-10-05T20:00:00Z"))).toBe(1);
    expect(workingDays(at(ordered), at("2026-10-09T20:00:00Z"))).toBe(5); // Mon–Fri
    expect(workingDays(at(ordered), at("2026-10-12T15:00:00Z"))).toBe(6); // + next Monday
  });

  it("uses US Eastern dates", () => {
    // 02:00 UTC Tuesday is still Monday evening in New York.
    expect(workingDays(at(ordered), at("2026-10-06T02:00:00Z"))).toBe(1);
  });
});

describe("deckProgress", () => {
  it("paces production by business day like the storefront tracker", () => {
    expect(deckProgress(order(), at("2026-10-05T20:00:00Z"))).toMatchObject({ step: "production", percent: 22, checklistDone: 3 });
    expect(deckProgress(order(), at("2026-10-06T15:00:00Z"))).toMatchObject({ step: "production", percent: 45, checklistDone: 5 });
    expect(deckProgress(order(), at("2026-10-07T15:00:00Z"))).toMatchObject({ step: "production", percent: 62, checklistDone: 7 });
  });

  it("stays in production until fulfillment is under way", () => {
    expect(deckProgress(order(), at("2026-10-12T15:00:00Z")).step).toBe("production");
  });

  it("moves to packing after 3 business days once fulfillment starts", () => {
    const o = order({ displayFulfillmentStatus: "IN_PROGRESS" });
    expect(deckProgress(o, at("2026-10-07T15:00:00Z")).step).toBe("production");
    expect(deckProgress(o, at("2026-10-08T15:00:00Z"))).toMatchObject({ step: "packing", percent: 71 });
    expect(deckProgress(o, at("2026-10-09T15:00:00Z"))).toMatchObject({ step: "packing", percent: 85 });
    expect(deckProgress(o, at("2026-10-12T15:00:00Z"))).toMatchObject({ step: "packing", percent: 95 });
    expect(deckProgress(o, at("2026-10-13T15:00:00Z"))).toMatchObject({ step: "packing", percent: 100 });
  });

  it("is shipped once fulfilled, and delivered once Shopify says so", () => {
    const fulfillment = { displayStatus: "IN_TRANSIT", createdAt: "2026-10-09T15:00:00Z", inTransitAt: "2026-10-10T12:00:00Z", deliveredAt: null, trackingInfo: [] };
    const shipped = order({ displayFulfillmentStatus: "FULFILLED", fulfillments: [fulfillment] });
    expect(deckProgress(shipped, at("2026-10-12T15:00:00Z"))).toMatchObject({ step: "shipped", shippedAt: at("2026-10-10T12:00:00Z") });

    const delivered = order({
      displayFulfillmentStatus: "FULFILLED",
      fulfillments: [{ ...fulfillment, displayStatus: "DELIVERED", deliveredAt: "2026-10-14T14:42:00Z" }],
    });
    expect(deckProgress(delivered)).toMatchObject({ step: "delivered", deliveredAt: at("2026-10-14T14:42:00Z") });
  });
});

describe("carrier and guarantee", () => {
  it("builds the carrier link from the order number's digits", () => {
    expect(carrierTrackingUrl("#212481885")).toBe("https://efwtrack.com/track/212481885");
  });

  it("gives 14 days from delivery to report missing parts", () => {
    const g = partsGuarantee(at("2026-10-14T14:42:00Z"), at("2026-10-15T12:00:00Z"));
    expect(g).toMatchObject({ active: true, daysLeft: 14, activeUntil: at("2026-10-28T14:42:00Z") });
    expect(partsGuarantee(at("2026-10-14T14:42:00Z"), at("2026-11-01T00:00:00Z"))?.active).toBe(false);
    expect(partsGuarantee(null)).toBeNull();
  });
});
