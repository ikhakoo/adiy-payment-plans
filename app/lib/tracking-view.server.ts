// HTML for an order's progress, shared by Track My Deck and the Overview.
import { esc } from "./portal.server";
import { fmtDay, fmtDayTime, type HubOrder } from "./orders.server";
import type { DeckProgress, DeckStep } from "./tracking";

const ORDER: DeckStep[] = ["production", "packing", "shipped", "delivered"];
const CHECK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

/** Headline copy for where the deck is now. */
export const STEP_COPY: Record<DeckStep, { pill: string; title: string; text: string }> = {
  production: {
    pill: "In production",
    title: "Your deck is now in production.",
    text: "Every A-DIY deck is made just for you, nothing sits in a warehouse.",
  },
  packing: {
    pill: "Ready to ship",
    title: "Getting your deck ready to ship.",
    text: "We're packing and securing everything for its trip to you.",
  },
  shipped: {
    pill: "Shipped",
    title: "Your deck is on its way.",
    text: "Your deck ships by LTL freight. The carrier will call you to schedule delivery once it reaches your local terminal.",
  },
  delivered: {
    pill: "Delivered",
    title: "Your deck has arrived.",
    text: "Please check all parts within 14 days of delivery.",
  },
};

/** The four-step strip (Production → Ready to Ship → Shipped → Delivered) from the Figma. */
export function progressStrip(order: HubOrder, p: DeckProgress) {
  const now = ORDER.indexOf(p.step);
  const steps = [
    { label: "Production", text: "Your deck is made and quality checked.", now: "Your deck is being made and quality checked." },
    { label: "Ready to ship", text: "Everything is packed and secured.", now: "We're packing and securing everything." },
    { label: "Shipped", text: "Your deck is on its way." },
    { label: "Delivered", text: p.deliveredAt ? "Your deck has arrived." : "Your deck arrives at your property." },
  ];
  const when = (i: number, state: string) => {
    if (i === 0) return `Ordered ${fmtDay(order.createdAt)}`;
    if (i === 2 && p.shippedAt && state !== "todo") return `Shipped ${fmtDay(p.shippedAt)}`;
    if (i === 3 && p.deliveredAt) return `Delivered ${fmtDayTime(p.deliveredAt)}`;
    if (state === "current") return `${p.percent}% complete`;
    return state === "todo" ? "Up next" : "";
  };
  const cards = steps
    .map((s, i) => {
      const state = i < now || p.step === "delivered" ? "done" : i === now ? "current" : "todo";
      const mark = state === "done" ? `<span class="step-check">${CHECK}</span>` : state === "current" ? `<span class="step-dot"></span>` : "";
      return `<div class="track-step ${state}${i === now ? " here" : ""}">
          <div class="track-step-head"><span>${String(i + 1).padStart(2, "0")} · ${s.label}</span>${mark}</div>
          <div class="track-step-bar"></div>
          <p>${state === "current" && "now" in s ? s.now : s.text}</p>
          <small>${esc(when(i, state))}</small>
        </div>`;
    })
    .join("");
  return `<div class="track-strip">${cards}</div>`;
}

/** Thin bar + percentage while the deck is still with us (production and packing). */
export function percentBar(p: DeckProgress) {
  if (p.step !== "production" && p.step !== "packing") return "";
  return `<div class="track-percent"><b>${p.percent}%</b> <span class="muted">of your deck is completed.</span>
    ${p.eta ? `<span class="pill mint dot">${esc(p.eta)}</span>` : ""}</div>
    <div class="meter" style="height:8px"><span style="width:${p.percent}%"></span></div>`;
}

/** Carrier + tracking numbers: Shopify's tracking info, if the fulfillment has any. */
export function shopifyTracking(order: HubOrder) {
  return order.fulfillments.flatMap((f) => f.trackingInfo).filter((t) => t.number || t.url);
}
