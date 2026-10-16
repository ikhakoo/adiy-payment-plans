// Where a deck order is in its journey. Paced like the storefront's tracking page
// (theme ikhakoo/adiy_noibu_v2 › sections/tracking-widget.liquid), but by hours rather than dates:
// production moves on every 24 weekday hours (US Eastern) since the order, packing starts once
// Shopify fulfillment is under way, and a fulfilled order is with the LTL carrier.

export type DeckStep = "production" | "packing" | "shipped" | "delivered";

export interface TrackableOrder {
  name: string; // "#212481885"
  createdAt: string;
  displayFulfillmentStatus: string;
  fulfillments: {
    displayStatus: string | null;
    createdAt: string;
    inTransitAt: string | null;
    deliveredAt: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
    /** Carrier scan events Shopify has for this fulfillment, if any. */
    events?: { nodes: { status: string; happenedAt: string; message: string | null }[] };
  }[];
}

const TZ = "America/New_York";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
/** The US Eastern wall-clock time of `d`, as if it were UTC, so whole days line up with ET midnights. */
function eastern(d: Date) {
  const p = Object.fromEntries(wallClock.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Hours from `start` to `end` that fall on weekdays (Mon–Fri, US Eastern). */
export function businessHours(start: Date, end: Date) {
  const from = eastern(start);
  const to = eastern(end);
  let ms = 0;
  for (let day = Math.floor(from / DAY) * DAY; day < to; day += DAY) {
    const dow = new Date(day).getUTCDay();
    if (dow !== 0 && dow !== 6) ms += Math.max(0, Math.min(to, day + DAY) - Math.max(from, day));
  }
  return ms / HOUR;
}

export const PRODUCTION_CHECKLIST = [
  { group: "Manufacturing", title: "Order confirmed", text: "Your deck specifications are finalized and sent to production." },
  { group: "Manufacturing", title: "Materials selected", text: "Your materials are selected and quality checked." },
  { group: "Manufacturing", title: "Components in production", text: "Your deck is taking shape. Every component is now in production." },
  { group: "Manufacturing", title: "Hardware preparation", text: "Your blocks, brackets and fasteners are being prepared for your kit." },
  { group: "Assembly", title: "Your deck comes together", text: "We assemble the complete frame to make sure every component fits as intended." },
  { group: "Assembly", title: "Everything lines up", text: "We check the deck for square, level and proper alignment." },
  { group: "Assembly", title: "Every connection is checked", text: "Brackets and connections are secured and the assembled deck is tested for stability." },
] as const;

export interface DeckProgress {
  step: DeckStep;
  /** Share of the build that's done, as shown on the theme's tracking page (22–100%). */
  percent: number;
  /** How many PRODUCTION_CHECKLIST items are ticked. */
  checklistDone: number;
  /** "Estimated: 3 business days" etc., while the deck is still with us. */
  eta: string | null;
  deliveredAt: Date | null;
  shippedAt: Date | null;
}

/** The theme's stage rules, plus "delivered" from Shopify (the theme hands off to the carrier instead). */
export function deckProgress(order: TrackableOrder, now = new Date()): DeckProgress {
  const delivered = order.fulfillments.find((f) => f.displayStatus === "DELIVERED" || f.deliveredAt);
  const shipped = order.fulfillments.find((f) => f.inTransitAt) ?? order.fulfillments[0];
  const deliveredAt = delivered ? new Date(delivered.deliveredAt ?? delivered.createdAt) : null;
  const shippedAt = shipped ? new Date(shipped.inTransitAt ?? shipped.createdAt) : null;
  if (deliveredAt) return { step: "delivered", percent: 100, checklistDone: 7, eta: null, deliveredAt, shippedAt };

  // Which 24-hour stretch of weekday time the order is in: 0 for its first 24 hours, and so on.
  const day = Math.floor(businessHours(new Date(order.createdAt), now) / 24);
  const status = order.displayFulfillmentStatus.toUpperCase();
  const underway = status === "IN_PROGRESS" || status === "FULFILLED" || status === "PARTIALLY_FULFILLED";

  if (day >= 3 && underway) {
    if (status === "FULFILLED") return { step: "shipped", percent: 100, checklistDone: 7, eta: null, deliveredAt, shippedAt };
    const packingDay = day - 3;
    const percent = packingDay === 0 ? 71 : packingDay === 1 ? 85 : packingDay === 2 ? 95 : 100;
    return { step: "packing", percent, checklistDone: 7, eta: "Estimate: 3 to 4 business days", deliveredAt, shippedAt };
  }
  const [percent, checklistDone] = day === 0 ? [22, 3] : day === 1 ? [45, 5] : [62, 7];
  return { step: "production", percent, checklistDone, eta: "Estimated: 3 business days", deliveredAt, shippedAt };
}

/** The LTL carrier's live tracking page, keyed by the order number's digits (as the theme does). */
export const carrierTrackingUrl = (orderName: string) => `https://efwtrack.com/track/${orderName.replace(/\D/g, "")}`;

/** The 14-day window to report missing or damaged parts, counted from delivery. */
export function partsGuarantee(deliveredAt: Date | null, now = new Date()) {
  if (!deliveredAt) return null;
  const activeUntil = new Date(deliveredAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  const daysLeft = Math.max(0, Math.ceil((activeUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  return { activeUntil, daysLeft, active: daysLeft > 0 };
}

export type UpdateKind = "production" | "packing" | "shipped" | "out" | "delivered" | "alert";
export interface OrderUpdate {
  kind: UpdateKind;
  title: string;
  text: string;
  /** null for the step under way right now, which has no date yet. */
  at: Date | null;
}

// Carrier events worth telling the customer about, keyed by Shopify's FulfillmentEventStatus.
const EVENT_COPY: Record<string, Omit<OrderUpdate, "at">> = {
  IN_TRANSIT: { kind: "shipped", title: "Your deck has shipped.", text: "Your deck has left our facility and is on its way to your local terminal." },
  OUT_FOR_DELIVERY: { kind: "out", title: "Your deck is out for delivery.", text: "Your deck has left the local terminal and is on its way to your property." },
  ATTEMPTED_DELIVERY: { kind: "alert", title: "Delivery was attempted.", text: "The carrier tried to deliver your deck. They'll contact you to arrange a new time." },
  DELAYED: { kind: "alert", title: "Your shipment is delayed.", text: "The carrier has reported a delay. We'll keep an eye on it and let you know if anything changes." },
  DELIVERED: { kind: "delivered", title: "Your deck has arrived.", text: "Your deck was delivered to the curb or driveway at your property." },
};

/**
 * The order's journey so far, newest first: real dates only (order placed, fulfillment created,
 * carrier events from Shopify), plus an undated entry for the step under way while we still have the deck.
 */
export function orderUpdates(order: TrackableOrder, p: DeckProgress): OrderUpdate[] {
  const out: OrderUpdate[] = [
    {
      kind: "production",
      title: "Your deck is in production.",
      text: "Your order is confirmed. Your materials are selected and your deck is being made just for you.",
      at: new Date(order.createdAt),
    },
  ];
  if (p.step === "packing") {
    out.push({ kind: "packing", title: "Your deck is getting ready to ship.", text: "Quality checks are under way. Everything is being packed and secured for its trip to you.", at: null });
  }
  const f = order.fulfillments[0];
  if (f) {
    out.push({ kind: "packing", title: "Your deck is ready to ship.", text: "Quality checks are complete. Everything is packed and secured for its trip to you.", at: new Date(f.createdAt) });
  }
  const seen = new Set<string>();
  for (const ff of order.fulfillments) {
    for (const e of ff.events?.nodes ?? []) {
      const copy = EVENT_COPY[e.status];
      const repeatable = e.status === "ATTEMPTED_DELIVERY" || e.status === "DELAYED";
      if (!copy || (seen.has(e.status) && !repeatable)) continue;
      seen.add(e.status);
      out.push({ ...copy, at: new Date(e.happenedAt) });
    }
  }
  if (!seen.has("IN_TRANSIT") && p.shippedAt && (p.step === "shipped" || p.step === "delivered")) {
    out.push({ ...EVENT_COPY.IN_TRANSIT, at: p.shippedAt });
  }
  if (!seen.has("DELIVERED") && p.deliveredAt) out.push({ ...EVENT_COPY.DELIVERED, at: p.deliveredAt });
  // Newest first; the undated "happening now" entry goes on top.
  return out.sort((a, b) => (b.at?.getTime() ?? Infinity) - (a.at?.getTime() ?? Infinity));
}
