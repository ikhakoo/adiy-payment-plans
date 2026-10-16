import { describe, expect, it } from "vitest";
import { parseTracker } from "./carrier.server";
import { carrierFor, deckProgress, deliveryWindow, orderUpdates, type TrackableOrder } from "./tracking";

// Trimmed from the order tracker's real responses (no customer details).
const shipment = (over = {}) => ({
  carrier: "EFW",
  trackingNumber: "8931015",
  trackingUrl: "https://efwtrack.com/track/8931015",
  scheduledDelivery: { from: "2026-10-19T15:00:00.000Z", to: "2026-10-19T19:00:00.000Z", type: "Between", active: false },
  ...over,
});
const ev = (code: string, description: string, at: string) => ({ code, description, at });
const EVENTS = [
  ev("WEB", "Shipment Created", "2026-10-08T14:50:00.000Z"),
  ev("PUP", "Picked Up", "2026-10-10T01:31:00.000Z"),
  ev("OHO", "Arrived at Origin City", "2026-10-10T02:46:00.000Z"),
  ev("INT", "In Transit", "2026-10-10T03:22:00.000Z"),
  ev("OHD", "Arrived at Destination City", "2026-10-13T16:27:00.000Z"),
  ev("APP", "Appointment Created", "2026-10-19T15:00:00.000Z"),
];
const inTransit = parseTracker({
  success: true,
  shipment: shipment(),
  delivery: { available: true, status: "Appointment Created", step: 4, totalSteps: 6, delivered: false, signedBy: null, events: EVENTS },
});
const delivered = parseTracker({
  success: true,
  shipment: shipment(),
  delivery: {
    available: true,
    status: "Delivered",
    step: 6,
    totalSteps: 6,
    delivered: true,
    deliveredAt: "2026-10-20T14:43:00.000Z", // carrier wall-clock, not used
    signedBy: "DARA",
    events: [...EVENTS, ev("OFD", "Out For Delivery", "2026-10-20T14:56:00.000Z"), ev("DEL", "Delivered", "2026-10-20T18:43:00.000Z")],
  } as never,
});
const awaitingPickup = parseTracker({
  success: true,
  shipment: shipment({ scheduledDelivery: { from: null, to: null, type: "By", active: false } }),
  delivery: { available: true, status: "Shipment Created", step: 0, totalSteps: 6, delivered: false, signedBy: null, events: [EVENTS[0]] },
});

const order = (carrier: TrackableOrder["carrier"], createdAt = "2026-10-06T14:00:00Z"): TrackableOrder => ({
  name: "#212481894",
  createdAt,
  displayFulfillmentStatus: "FULFILLED",
  fulfillments: [{ displayStatus: "FULFILLED", createdAt: "2026-10-08T15:00:00Z", inTransitAt: null, deliveredAt: null, trackingInfo: [] }],
  carrier,
});

describe("parseTracker", () => {
  it("returns nothing for unknown or unshipped orders", () => {
    expect(parseTracker({ success: false })).toBeNull();
    expect(parseTracker({ success: true, shipment: null, delivery: null })).toBeNull();
  });
});

describe("deckProgress with the carrier", () => {
  it("waits for pickup before counting as shipped", () => {
    expect(deckProgress(order(awaitingPickup))).toMatchObject({
      step: "shipped",
      percent: 0,
      shippedAt: null,
      delivery: { step: 0, totalSteps: 6, label: "Waiting for pickup" },
    });
  });

  it("follows the carrier's step once picked up", () => {
    expect(deckProgress(order(inTransit))).toMatchObject({
      step: "shipped",
      percent: 67,
      shippedAt: new Date("2026-10-10T01:31:00.000Z"),
      delivery: { step: 4, label: "At your local terminal" },
    });
  });

  it("is delivered at the carrier's delivery scan, before Shopify knows", () => {
    expect(deckProgress(order(delivered))).toMatchObject({ step: "delivered", deliveredAt: new Date("2026-10-20T18:43:00.000Z") });
  });

  it("trusts the tracker even for another order's scans, while test orders need that", () => {
    // TODO(test mode): see carrierFor. A fulfillment entered with another order's tracking number.
    const borrowed = order(delivered, "2026-10-14T19:00:00Z");
    expect(carrierFor(borrowed)).toBe(delivered);
    expect(deckProgress(borrowed)).toMatchObject({ step: "delivered" });
  });
});

describe("delivery window", () => {
  it("reads the carrier's wall-clock times as they are", () => {
    expect(deliveryWindow(inTransit)).toBe("Oct 19, 3:00 PM – 7:00 PM");
    expect(deliveryWindow(awaitingPickup)).toBeNull();
  });
});

describe("orderUpdates with the carrier", () => {
  it("lists the carrier's scans, newest first, with the appointment window", () => {
    const o = order(inTransit);
    const u = orderUpdates(o, deckProgress(o));
    expect(u.map((x) => x.title)).toEqual([
      "Your delivery is scheduled.",
      "Your deck reached your local terminal.",
      "Your deck is in transit.",
      "Your deck reached the carrier's terminal.",
      "Your deck has shipped.",
      "Your deck is ready to ship.",
      "Your deck is in production.",
    ]);
    expect(u[0]).toMatchObject({ text: "Delivery window: Oct 19, 3:00 PM – 7:00 PM.", stamp: "Oct 19, 3:00 PM – 7:00 PM" });
  });

  it("says who signed for the delivery", () => {
    const o = order(delivered);
    const u = orderUpdates(o, deckProgress(o));
    expect(u[0]).toMatchObject({ kind: "delivered", text: expect.stringContaining("Signed for by DARA.") });
    expect(u.filter((x) => x.kind === "delivered")).toHaveLength(1);
  });
});
