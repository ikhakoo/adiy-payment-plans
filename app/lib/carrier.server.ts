// Live LTL delivery progress from A-DIY's order tracker worker, which reads the carrier's (EFW) scans.
// Only fetched for the order on screen, once it has a fulfillment. Any failure just means no carrier
// data: the hub falls back to what Shopify knows.
import type { CarrierTracking } from "./tracking";

const TRACKER_URL = "https://adiy-order-tracker.a-diy.workers.dev/track";
const TIMEOUT_MS = 4000;
const TTL_MS = 2 * 60 * 1000;

const cache = new Map<string, { at: number; value: CarrierTracking | null }>();

interface TrackerResponse {
  success?: boolean;
  shipment?: {
    carrier?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    scheduledDelivery?: { from?: string | null; to?: string | null; type?: string | null } | null;
  } | null;
  delivery?: {
    available?: boolean;
    status?: string | null;
    step?: number | null;
    totalSteps?: number | null;
    delivered?: boolean;
    signedBy?: string | null;
    events?: { code?: string; description?: string; at?: string }[] | null;
  } | null;
}

/** The tracker's answer for an order, trimmed to what the hub shows. */
export function parseTracker(json: TrackerResponse): CarrierTracking | null {
  const s = json.shipment;
  const d = json.delivery;
  if (!json.success || !s || !d?.available) return null;
  const events = (d.events ?? [])
    .filter((e) => e.code && e.at && !Number.isNaN(Date.parse(e.at)))
    .map((e) => ({ code: e.code!, description: e.description ?? "", at: e.at! }));
  return {
    carrier: s.carrier ?? null,
    trackingNumber: s.trackingNumber ?? null,
    trackingUrl: s.trackingUrl ?? null,
    status: d.status ?? null,
    step: Math.max(0, d.step ?? 0),
    totalSteps: Math.max(1, d.totalSteps ?? 6),
    delivered: !!d.delivered,
    signedBy: d.signedBy?.trim() || null,
    scheduled: s.scheduledDelivery?.from || s.scheduledDelivery?.to
      ? { from: s.scheduledDelivery.from ?? null, to: s.scheduledDelivery.to ?? null, type: s.scheduledDelivery.type ?? null }
      : null,
    events,
  };
}

/** Carrier progress for an order ("#212481895"), or null when there's none or the tracker is down. */
export async function carrierTracking(orderName: string): Promise<CarrierTracking | null> {
  const number = orderName.replace(/\D/g, "");
  if (!number) return null;
  const hit = cache.get(number);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: CarrierTracking | null = null;
  try {
    const res = await fetch(`${TRACKER_URL}?order=${number}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) value = parseTracker(await res.json());
    else if (res.status !== 404) throw new Error(`tracker ${res.status}`);
  } catch (err) {
    console.warn(`carrier tracking for ${number} failed:`, err);
    return null; // don't cache outages
  }
  cache.set(number, { at: Date.now(), value });
  return value;
}
