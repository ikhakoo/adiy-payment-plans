import type { LoaderFunctionArgs } from "react-router";
import { esc } from "../lib/portal.server";
import { hubContext, renderHub } from "../lib/hub.server";
import { fmtDay, mainLine, orderQuery, orderSwitcher, selectedOrder } from "../lib/orders.server";
import { deckProgress, partsGuarantee } from "../lib/tracking";
import { carrierCards, checklistTimeline, GLYPH, liveTrackingUrl, orderNo, percentBar, progressLine, STEP_COPY, updatesTimeline } from "../lib/tracking-view.server";


// GET /apps/hub/track — Track My Deck: production progress, shipping and delivery for one order.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;
  const { orders, order } = await selectedOrder(ctx, request);

  if (!order) {
    return renderHub(ctx, "track", "Track My Deck", `
      <div class="page-head"><h1 class="h1">Track your deck.</h1></div>
      <div class="card flat"><p class="muted" style="margin:0">You don't have any orders to track yet.</p></div>`);
  }

  const p = deckProgress(order);
  const copy = STEP_COPY[p.step];
  const line = mainLine(order);
  const support = (topic: string) => ctx.url(`/support?topic=${topic}&order=${order.numericId}`);
  const withCarrier = p.step === "shipped" || p.step === "delivered";
  const guarantee = partsGuarantee(p.deliveredAt);

  // Plan orders ship once the final payment is made, so production may pause before packing.
  const nextPayment = order.plan?.installments.find((i) => i.status !== "PAID");
  const planHold =
    order.plan && Number(order.plan.outstanding) > 0 && !withCarrier
      ? `<div class="notice warn">Your deck ships once your Pay in ${order.plan.installmentsCount} plan is paid off.${
          nextPayment ? ` Next payment ${fmtDay(nextPayment.dueDate)}.` : ""
        }</div>`
      : "";

  // While we still have the deck: the theme's build checklist.
  const checklist =
    p.step === "production"
      ? `<div class="card trk-checks">
          <h2 class="h2">What's happening right now</h2>
          <p class="muted">Nothing leaves here until every check passes.</p>
          ${checklistTimeline(p)}
        </div>`
      : "";
  const deliveryDay =
    p.step === "packing" || p.step === "shipped"
      ? `<div class="card">
          <h2 class="h2">Get ready for delivery day</h2>
          <p class="muted">Your deck ships by LTL freight. Here's what to expect once it's on the way.</p>
          <div class="steps" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
            <div><div class="h3">Track it live</div><p class="muted">Follow your shipment from the moment it leaves our facility.</p></div>
            <div><div class="h3">The carrier will call you</div><p class="muted">Once your deck reaches the local terminal, the delivery team will call to schedule a time. If they arrive without unloading equipment, don't arrange it yourself. Contact us and we'll coordinate a safe delivery.</p></div>
            <div><div class="h3">Delivered curbside</div><p class="muted">Your deck will be delivered to the curb or driveway at your property.</p></div>
            <div><div class="h3">Check everything within 14 days</div><p class="muted">Make sure all parts arrived safely. If you need more time to inspect, just let our team know.</p></div>
          </div>
        </div>`
      : "";

  const chip =
    p.step === "delivered"
      ? `<span class="trk-chip-status ok">${GLYPH.checkCircle}Confirmed</span>`
      : p.step === "shipped"
        ? `<span class="trk-chip-status">${p.delivery ? esc(p.delivery.label) : "In transit"}</span>`
        : `<span class="trk-chip-status warn">${p.percent}% complete</span>`;

  const bar = percentBar(p, order);
  const body = `
    <div class="page-head trk-head">
      <div>
        <h1 class="h1">Track your deck.</h1>
        <p class="trk-meta">Order ${esc(orderNo(order.name))}${line ? `<i></i><b>${esc(line.title)}</b>` : ""}</p>
      </div>
      <span class="trk-status ${p.step === "delivered" ? "ok" : p.step === "shipped" ? "" : "warn"}"><i></i>${copy.pill}</span>
    </div>
    ${orderSwitcher(ctx, "/track", orders, order)}
    ${planHold}
    <div class="card trk-main">
      <div class="trk-top">
        <div>
          <div class="trk-title"><h2>${copy.pill}</h2>${chip}</div>
          <p class="trk-sub">${copy.title} ${copy.text}</p>
        </div>
        ${withCarrier ? `<a class="trk-top-btn" href="${esc(liveTrackingUrl(order))}" target="_blank" rel="noopener">${GLYPH.receipt}Track shipment live</a>` : ""}
      </div>
      ${bar ? `<div class="trk-percent">${bar}</div>` : ""}
      ${progressLine(order, p)}
      ${carrierCards(order, p)}
      ${updatesTimeline(order, p)}
    </div>
    ${checklist}
    ${deliveryDay}
    <div class="grid2 trk-grid">
      <div class="card trk-card2">
        <span class="trk-tile">${GLYPH.book}</span>
        <div class="trk-kicker">Next step: assembly</div>
        <h2 class="h2">Ready to build?</h2>
        <p class="trk-card2-text">Find your installation guide, footing plan, and interactive 3D instructions for your deck kit.</p>
        <div class="trk-tags"><span>Installation guide</span><span>Footing plan</span><span>3D instructional app</span></div>
        <div class="spacer"></div>
        <div><a class="trk-btn-dark" href="${ctx.url(`/resources${orderQuery(order)}`)}">View build resources ${GLYPH.arrow}</a></div>
      </div>
      <div class="card trk-card2">
        <span class="trk-tile">${GLYPH.shield}</span>
        <div class="trk-kicker">Check your delivery</div>
        <h2 class="h2">Something missing or damaged?</h2>
        <p class="trk-card2-text">Please check all parts within 14 days of delivery. If anything is missing or damaged, send us photos and a short description.</p>
        <div class="trk-guarantee${guarantee && !guarantee.active ? " ended" : ""}">${GLYPH.clipboardCheck}<span>${
          guarantee
            ? guarantee.active
              ? `Active until ${fmtDay(guarantee.activeUntil)} (${guarantee.daysLeft} ${guarantee.daysLeft === 1 ? "day" : "days"} remaining)`
              : `Ended ${fmtDay(guarantee.activeUntil)}`
            : "Your 14 days start when your deck is delivered"
        }</span></div>
        <div class="spacer"></div>
        <div><a class="trk-btn-soft" href="${support("parts")}">Report an issue</a></div>
      </div>
    </div>
    <script>
      document.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-copy-value]");
        if (!b || !navigator.clipboard) return;
        navigator.clipboard.writeText(b.getAttribute("data-copy-value")).then(function () {
          var t = b.querySelector("span") || b; t.textContent = "Copied!";
        });
      });
    </script>`;

  return renderHub(ctx, "track", "Track My Deck", body);
};
