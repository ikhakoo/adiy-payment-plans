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
  /** The LTL carrier's own progress, from the order tracker worker (carrier.server.ts), once fulfilled. */
  carrier?: CarrierTracking | null;
}

/**
 * The carrier's view of a shipment. Event times are real UTC; `scheduled` is the destination's
 * wall-clock time written with a "Z", so it's shown as-is rather than converted.
 */
export interface CarrierTracking {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string | null;
  /** 0 (shipment created) to `totalSteps` (delivered). */
  step: number;
  totalSteps: number;
  delivered: boolean;
  signedBy: string | null;
  scheduled: { from: string | null; to: string | null; type: string | null } | null;
  /** Oldest first, keyed by the carrier's codes: WEB, PUP, OHO, INT, OHD, LM1, APP, OFD, ATD, DEL… */
  events: { code: string; description: string; at: string }[];
}

/** What each of the carrier's 0–6 steps means to the customer. */
export const DELIVERY_STEPS = [
  "Waiting for pickup",
  "Picked up by the carrier",
  "At the carrier's origin terminal",
  "In transit",
  "At your local terminal",
  "Out for delivery",
  "Delivered",
];

/**
 * The carrier's data for a fulfilled order.
 *
 * TODO(test mode): put the guard back before real customers use the hub, or skip it only in a test
 * mode. Test orders are fulfilled with other orders' tracking numbers to show each delivery scenario,
 * so for now we trust whatever the tracker returns; a real order with a mistyped tracking number would
 * then show someone else's shipment. The guard was: ignore the carrier data when any scan predates
 * the order (`c.events.some((e) => new Date(e.at) < new Date(order.createdAt))`).
 */
export function carrierFor(order: TrackableOrder) {
  const c = order.carrier;
  return c && order.fulfillments.length ? c : null;
}
const eventAt = (c: CarrierTracking | null, code: string) => {
  const e = c?.events.find((x) => x.code === code);
  return e ? new Date(e.at) : null;
};

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
  /** The carrier's step once it has the deck: 0 (waiting for pickup) to 6 (delivered). */
  delivery: { step: number; totalSteps: number; label: string } | null;
}

/**
 * The theme's stage rules, plus "delivered" from Shopify (the theme hands off to the carrier instead).
 * Unlike the theme, a fulfilled order shows as shipped straight away, even inside the first 72 hours.
 */
export function deckProgress(order: TrackableOrder, now = new Date()): DeckProgress {
  const c = carrierFor(order);
  const delivered = order.fulfillments.find((f) => f.displayStatus === "DELIVERED" || f.deliveredAt);
  const shipped = order.fulfillments.find((f) => f.inTransitAt) ?? order.fulfillments[0];
  // The carrier's scans win when we have them: shipped means picked up, not just fulfilled.
  const deliveredAt =
    (c && (eventAt(c, "DEL") ?? (c.delivered ? new Date(c.events.at(-1)?.at ?? Date.now()) : null))) ??
    (delivered ? new Date(delivered.deliveredAt ?? delivered.createdAt) : null);
  const shippedAt = c ? eventAt(c, "PUP") : shipped ? new Date(shipped.inTransitAt ?? shipped.createdAt) : null;
  const total = c?.totalSteps ?? 6;
  const delivery = (step: number) => ({
    step,
    totalSteps: total,
    label: (total === DELIVERY_STEPS.length - 1 ? DELIVERY_STEPS[step] : null) ?? c?.status ?? "",
  });
  if (deliveredAt) return { step: "delivered", percent: 100, checklistDone: 7, eta: null, deliveredAt, shippedAt, delivery: c ? delivery(total) : null };

  const status = order.displayFulfillmentStatus.toUpperCase();
  if (status === "FULFILLED") {
    const step = c ? Math.min(c.step, total - 1) : null;
    const percent = step === null ? 100 : Math.round((step / total) * 100);
    return { step: "shipped", percent, checklistDone: 7, eta: null, deliveredAt, shippedAt, delivery: step === null ? null : delivery(step) };
  }

  // Which 24-hour stretch of weekday time the order is in: 0 for its first 24 hours, and so on.
  const day = Math.floor(businessHours(new Date(order.createdAt), now) / 24);
  const underway = status === "IN_PROGRESS" || status === "PARTIALLY_FULFILLED";

  if (day >= 3 && underway) {
    const packingDay = day - 3;
    const percent = packingDay === 0 ? 71 : packingDay === 1 ? 85 : packingDay === 2 ? 95 : 100;
    return { step: "packing", percent, checklistDone: 7, eta: "Estimate: 3 to 4 business days", deliveredAt, shippedAt, delivery: null };
  }
  const [percent, checklistDone] = day === 0 ? [22, 3] : day === 1 ? [45, 5] : [62, 7];
  return { step: "production", percent, checklistDone, eta: "Estimated: 3 business days", deliveredAt, shippedAt, delivery: null };
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
  /** Shown instead of `at` when the time isn't a moment we can convert (a delivery appointment). */
  stamp?: string;
}

// Carrier events worth telling the customer about, keyed by Shopify's FulfillmentEventStatus.
const EVENT_COPY: Record<string, Omit<OrderUpdate, "at">> = {
  IN_TRANSIT: { kind: "shipped", title: "Your deck has shipped.", text: "Your deck has left our facility and is on its way to your local terminal." },
  OUT_FOR_DELIVERY: { kind: "out", title: "Your deck is out for delivery.", text: "Your deck has left the local terminal and is on its way to your property." },
  ATTEMPTED_DELIVERY: { kind: "alert", title: "Delivery was attempted.", text: "The carrier tried to deliver your deck. They'll contact you to arrange a new time." },
  DELAYED: { kind: "alert", title: "Your shipment is delayed.", text: "The carrier has reported a delay. We'll keep an eye on it and let you know if anything changes." },
  DELIVERED: { kind: "delivered", title: "Your deck has arrived.", text: "Your deck was delivered to the curb or driveway at your property." },
};

/** "Oct 19, 11:00 AM": a carrier wall-clock time, which already reads in the delivery address's time. */
const fmtWall = (iso: string, withDay = true) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "UTC",
    ...(withDay ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });

/** "Oct 19, 11:00 AM – 3:00 PM", "By Oct 19, 5:00 PM", or null when the carrier hasn't booked one. */
export function deliveryWindow(c: CarrierTracking | null) {
  const w = c?.scheduled;
  if (!w?.from && !w?.to) return null;
  if (w.from && w.to && Date.parse(w.to) > Date.parse(w.from) && w.from.slice(0, 10) === w.to.slice(0, 10)) {
    return `${fmtWall(w.from)} – ${fmtWall(w.to, false)}`;
  }
  if (w.type === "By" && w.to && (!w.from || Date.parse(w.to) > Date.parse(w.from))) return `By ${fmtWall(w.to)}`;
  return w.from ? fmtWall(w.from) : null;
}

// The carrier's scan codes, in customer words. Codes not listed fall back to the carrier's description.
const CARRIER_COPY: Record<string, Omit<OrderUpdate, "at">> = {
  PUP: { kind: "shipped", title: "Your deck has shipped.", text: "The carrier picked up your deck from our facility. It's on its way to your local terminal." },
  OHO: { kind: "shipped", title: "Your deck reached the carrier's terminal.", text: "It's being loaded for the trip to your area." },
  INT: { kind: "shipped", title: "Your deck is in transit.", text: "Your deck is on its way to your local terminal." },
  OHD: { kind: "shipped", title: "Your deck reached your local terminal.", text: "The carrier will call you to schedule a delivery time." },
  LM1: { kind: "alert", title: "The carrier tried to reach you.", text: "They called to schedule your delivery. If you missed it, contact us and we'll help set a time." },
  LM2: { kind: "alert", title: "The carrier tried to reach you again.", text: "They called to schedule your delivery. If you missed it, contact us and we'll help set a time." },
  APP: { kind: "out", title: "Your delivery is scheduled.", text: "The carrier has booked a time to deliver your deck." },
  OFD: { kind: "out", title: "Your deck is out for delivery.", text: "Your deck has left the local terminal and is on its way to your property." },
  ATD: { kind: "alert", title: "Delivery was attempted.", text: "The carrier tried to deliver your deck. They'll contact you to arrange a new time." },
  DEL: { kind: "delivered", title: "Your deck has arrived.", text: "Your deck was delivered to the curb or driveway at your property." },
};

/** The carrier's scans as order updates (skipping "shipment created": the fulfillment already says that). */
function carrierUpdates(c: CarrierTracking): OrderUpdate[] {
  const window = deliveryWindow(c);
  return c.events.flatMap((e): OrderUpdate[] => {
    if (e.code === "WEB") return [];
    const copy = CARRIER_COPY[e.code] ?? (/^LM\d/.test(e.code) ? CARRIER_COPY.LM2 : null);
    if (e.code === "APP") {
      // The appointment's time is the booked slot, in local wall-clock time.
      return [{ ...CARRIER_COPY.APP, text: window ? `Delivery window: ${window}.` : CARRIER_COPY.APP.text, at: new Date(e.at), stamp: window ?? fmtWall(e.at) }];
    }
    if (e.code === "DEL" && c.signedBy) return [{ ...CARRIER_COPY.DEL, text: `${CARRIER_COPY.DEL.text} Signed for by ${c.signedBy}.`, at: new Date(e.at) }];
    if (copy) return [{ ...copy, at: new Date(e.at) }];
    return e.description ? [{ kind: "shipped", title: `${e.description.replace(/\.$/, "")}.`, text: "", at: new Date(e.at) }] : [];
  });
}

/**
 * The order's journey so far, newest first: real dates only (order placed, fulfillment created,
 * the carrier's scans, or Shopify's carrier events without them), plus an undated entry for the step under way while we still have the deck.
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
  const c = carrierFor(order);
  if (c) {
    // The carrier's scans replace Shopify's events, including the "shipped" fallback below.
    out.push(...carrierUpdates(c));
    seen.add("IN_TRANSIT");
    if (c.events.some((e) => e.code === "DEL")) seen.add("DELIVERED");
  }
  for (const ff of c ? [] : order.fulfillments) {
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
