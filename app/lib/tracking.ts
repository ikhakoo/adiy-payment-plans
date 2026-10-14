// Where a deck order is in its journey. Ported from the storefront's tracking page
// (theme ikhakoo/adiy_noibu_v2 › sections/tracking-widget.liquid) so the hub and that page agree:
// progress through production is paced by business days since the order (US Eastern), packing
// starts once Shopify fulfillment is under way, and a fulfilled order is with the LTL carrier.

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
  }[];
}

const TZ = "America/New_York";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD

/** Weekdays from `start` to `end`, both days included, by US Eastern calendar dates. */
export function workingDays(start: Date, end: Date) {
  const cur = new Date(`${dayKey(start)}T00:00:00Z`);
  const last = new Date(`${dayKey(end)}T00:00:00Z`);
  let count = 0;
  while (cur <= last) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
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

  const days = workingDays(new Date(order.createdAt), now);
  const status = order.displayFulfillmentStatus.toUpperCase();
  const underway = status === "IN_PROGRESS" || status === "FULFILLED" || status === "PARTIALLY_FULFILLED";

  if (days > 3 && underway) {
    if (status === "FULFILLED") return { step: "shipped", percent: 100, checklistDone: 7, eta: null, deliveredAt, shippedAt };
    const packingDays = days - 3;
    const percent = packingDays <= 1 ? 71 : packingDays === 2 ? 85 : packingDays === 3 ? 95 : 100;
    return { step: "packing", percent, checklistDone: 7, eta: "Estimate: 3 to 4 business days", deliveredAt, shippedAt };
  }
  const [percent, checklistDone] = days <= 1 ? [22, 3] : days === 2 ? [45, 5] : [62, 7];
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
