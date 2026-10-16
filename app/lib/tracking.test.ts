import { describe, expect, it } from "vitest";
import { carrierTrackingUrl, deckProgress, orderUpdates, partsGuarantee, businessHours, type TrackableOrder } from "./tracking";

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

describe("businessHours", () => {
  it("counts elapsed hours", () => {
    expect(businessHours(at(ordered), at("2026-10-05T20:00:00Z"))).toBe(6);
    expect(businessHours(at(ordered), at("2026-10-07T14:00:00Z"))).toBe(48);
  });

  it("skips weekends by US Eastern dates", () => {
    // Fri 10:00 ET → Mon 10:00 ET is 14 hours of Friday plus 10 of Monday.
    expect(businessHours(at("2026-10-09T14:00:00Z"), at("2026-10-12T14:00:00Z"))).toBe(24);
    // An order placed on Saturday starts counting at Monday midnight ET.
    expect(businessHours(at("2026-10-10T16:00:00Z"), at("2026-10-12T14:00:00Z"))).toBe(10);
  });
});

describe("deckProgress", () => {
  it("paces production by 24 weekday hours like the storefront tracker", () => {
    expect(deckProgress(order(), at("2026-10-06T13:59:00Z"))).toMatchObject({ step: "production", percent: 22, checklistDone: 3 });
    expect(deckProgress(order(), at("2026-10-06T14:00:00Z"))).toMatchObject({ step: "production", percent: 45, checklistDone: 5 });
    expect(deckProgress(order(), at("2026-10-07T13:59:00Z"))).toMatchObject({ step: "production", percent: 45, checklistDone: 5 });
    expect(deckProgress(order(), at("2026-10-07T14:00:00Z"))).toMatchObject({ step: "production", percent: 62, checklistDone: 7 });
  });

  it("doesn't advance at midnight", () => {
    // Ordered Mon 16:00 ET; Tue 09:00 ET is only 17 hours later.
    const late = order({ createdAt: "2026-10-05T20:00:00Z" });
    expect(deckProgress(late, at("2026-10-06T13:00:00Z"))).toMatchObject({ percent: 22, checklistDone: 3 });
  });

  it("stays in production until fulfillment is under way", () => {
    expect(deckProgress(order(), at("2026-10-12T15:00:00Z")).step).toBe("production");
  });

  it("moves to packing after 72 weekday hours once fulfillment starts", () => {
    const o = order({ displayFulfillmentStatus: "IN_PROGRESS" });
    expect(deckProgress(o, at("2026-10-08T13:59:00Z")).step).toBe("production");
    expect(deckProgress(o, at("2026-10-08T14:00:00Z"))).toMatchObject({ step: "packing", percent: 71 });
    expect(deckProgress(o, at("2026-10-09T14:00:00Z"))).toMatchObject({ step: "packing", percent: 85 });
    expect(deckProgress(o, at("2026-10-12T14:00:00Z"))).toMatchObject({ step: "packing", percent: 95 });
    expect(deckProgress(o, at("2026-10-13T14:00:00Z"))).toMatchObject({ step: "packing", percent: 100 });
  });

  it("is shipped once fulfilled, and delivered once Shopify says so", () => {
    const fulfillment = { displayStatus: "IN_TRANSIT", createdAt: "2026-10-09T15:00:00Z", inTransitAt: "2026-10-10T12:00:00Z", deliveredAt: null, trackingInfo: [] };
    const shipped = order({ displayFulfillmentStatus: "FULFILLED", fulfillments: [fulfillment] });
    expect(deckProgress(shipped, at("2026-10-12T15:00:00Z"))).toMatchObject({ step: "shipped", shippedAt: at("2026-10-10T12:00:00Z") });
    // Even when it's fulfilled inside the first 72 hours.
    expect(deckProgress(shipped, at("2026-10-06T15:00:00Z"))).toMatchObject({ step: "shipped", percent: 100 });

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

describe("orderUpdates", () => {
  it("starts with the order going into production", () => {
    const o = order();
    const u = orderUpdates(o, deckProgress(o, at("2026-10-06T15:00:00Z")));
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ kind: "production", at: at(ordered) });
  });

  it("puts the undated packing step on top while we pack", () => {
    const o = order({ displayFulfillmentStatus: "IN_PROGRESS" });
    const u = orderUpdates(o, deckProgress(o, at("2026-10-09T15:00:00Z")));
    expect(u.map((x) => x.kind)).toEqual(["packing", "production"]);
    expect(u[0].at).toBeNull();
  });

  it("uses Shopify's carrier events, newest first, and fills in shipped/delivered from the fulfillment", () => {
    const f = {
      displayStatus: "DELIVERED", createdAt: "2026-10-09T15:00:00Z", inTransitAt: "2026-10-10T12:00:00Z", deliveredAt: "2026-10-14T14:42:00Z", trackingInfo: [],
      events: { nodes: [
        { status: "LABEL_PRINTED", happenedAt: "2026-10-09T16:00:00Z", message: null },
        { status: "OUT_FOR_DELIVERY", happenedAt: "2026-10-14T12:00:00Z", message: null },
      ] },
    };
    const o = order({ displayFulfillmentStatus: "FULFILLED", fulfillments: [f] });
    const u = orderUpdates(o, deckProgress(o));
    expect(u.map((x) => x.kind)).toEqual(["delivered", "out", "shipped", "packing", "production"]);
    expect(u[2].at).toEqual(at("2026-10-10T12:00:00Z"));
  });
});
