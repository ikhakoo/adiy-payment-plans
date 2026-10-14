import type { LoaderFunctionArgs } from "react-router";
import { esc } from "../lib/portal.server";
import { hubContext, renderHub } from "../lib/hub.server";
import { fmtDay, fmtDayTime, mainLine, orderQuery, orderSwitcher, selectedOrder } from "../lib/orders.server";
import { carrierTrackingUrl, deckProgress, partsGuarantee, PRODUCTION_CHECKLIST } from "../lib/tracking";
import { percentBar, progressStrip, shopifyTracking, STEP_COPY } from "../lib/tracking-view.server";

const CHECK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

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
  const tracking = shopifyTracking(order);
  const guarantee = partsGuarantee(p.deliveredAt);

  // Plan orders ship once the final payment is made, so production may pause before packing.
  const nextPayment = order.plan?.installments.find((i) => i.status !== "PAID");
  const planHold =
    order.plan && Number(order.plan.outstanding) > 0 && !withCarrier
      ? `<div class="notice warn">Your deck ships once your Pay in ${order.plan.installmentsCount} plan is paid off.${
          nextPayment ? ` Next payment ${fmtDay(nextPayment.dueDate)}.` : ""
        }</div>`
      : "";

  const carrierRows = withCarrier
    ? `<ul class="rows" style="margin-top:20px">
        <li><div><div class="label">Carrier &amp; tracking details</div>
          <div>LTL freight · Order ${esc(order.name)}</div>
          ${tracking.map((t) => `<div class="muted">${esc(t.company ?? "Carrier")} ${t.number ? `· ${esc(t.number)}` : ""}</div>`).join("")}</div>
          <div class="btn-row" style="justify-content:flex-end">
            ${tracking[0]?.number ? `<button class="btn light" type="button" data-copy-value="${esc(tracking[0].number)}">Copy tracking number</button>` : ""}
            <a class="btn" href="${esc(tracking.find((t) => t.url)?.url ?? carrierTrackingUrl(order.name))}" target="_blank" rel="noopener">Track shipment live</a>
          </div></li>
        ${
          p.deliveredAt
            ? `<li><div><div class="label">Delivery confirmation</div><div>${fmtDayTime(p.deliveredAt)}</div>
                <div class="muted">Your carrier has confirmed delivery to your property.</div></div></li>`
            : ""
        }
      </ul>`
    : "";

  // While we still have the deck: the theme's build checklist, and the steps & railings offer.
  const checklist =
    p.step === "production"
      ? `<div class="card">
          <h2 class="h2">What's happening right now</h2>
          <p class="muted">Nothing leaves here until every check passes.</p>
          <ul class="checklist">${PRODUCTION_CHECKLIST.map(
            (c, i) => `<li class="${i < p.checklistDone ? "done" : ""}"><span class="box">${i < p.checklistDone ? CHECK : ""}</span>
              <div><b>${c.title}</b><span>${c.text}</span></div></li>`,
          ).join("")}</ul>
        </div>`
      : "";
  const upsell =
    p.step === "production" || p.step === "packing"
      ? `<div class="card upsell">
          <span class="pill gold dot">${p.step === "packing" ? "Last chance, leaves in a few days" : "Before we pack your order"}</span>
          <h2 class="h2" style="margin-top:10px">${p.step === "packing" ? "Last chance to add steps & railings." : "Thinking about steps & railings? Now is the time."}</h2>
          <p class="muted">${
            p.step === "packing"
              ? "Your deck is being packed for shipment. This is the final point where we can add steps or railings and send everything together at no additional shipping cost."
              : "Your deck is still in production, which means we can add them to the same shipment at no additional shipping cost. Once your deck leaves our facility, steps and railings become a separate shipment."
          }</p>
          <a class="btn" href="${ctx.url("/support")}" data-hub-chat>Chat with us to add steps or railings</a>
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

  const body = `
    <div class="page-head" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <div>
        <h1 class="h1">Track your deck.</h1>
        <p class="muted" style="font-size:14px;margin:0">Order ${esc(order.name)}${line ? ` · ${esc(line.title)}` : ""}</p>
      </div>
      <span class="pill ${p.step === "delivered" ? "mint" : "gold"} dot">${copy.pill}</span>
    </div>
    ${orderSwitcher(ctx, "/track", orders, order)}
    ${planHold}
    <div class="card">
      <div class="card-head">
        <div><h2 class="h2">${copy.title}</h2><p class="muted" style="margin:0">${copy.text}</p></div>
      </div>
      ${percentBar(p)}
      <div style="margin-top:16px">${progressStrip(order, p)}</div>
      ${carrierRows}
    </div>
    ${upsell}
    ${checklist}
    ${deliveryDay}
    <div class="grid2">
      <div class="card">
        <div class="label">Next step: assembly</div>
        <h2 class="h2" style="margin-top:6px">Ready to build?</h2>
        <p class="muted">Find your installation guide, footing plan, and interactive 3D instructions for your deck kit.</p>
        <div class="btn-row" style="margin-bottom:16px"><span class="pill">Installation guide</span><span class="pill">Footing plan</span><span class="pill">3D instructional app</span></div>
        <div class="spacer"></div>
        <div><a class="btn" href="${ctx.url(`/resources${orderQuery(order)}`)}">View build resources</a></div>
      </div>
      <div class="card">
        <div class="label">Check your delivery</div>
        <h2 class="h2" style="margin-top:6px">Something missing or damaged?</h2>
        <p class="muted">Please check all parts within 14 days of delivery. If anything is missing or damaged, send us photos and a short description.</p>
        ${
          guarantee
            ? `<p><span class="pill ${guarantee.active ? "ok" : ""} dot">${
                guarantee.active ? `Active until ${fmtDay(guarantee.activeUntil)} (${guarantee.daysLeft} days remaining)` : `Ended ${fmtDay(guarantee.activeUntil)}`
              }</span></p>`
            : `<p><span class="pill">Starts when your deck is delivered</span></p>`
        }
        <div class="spacer"></div>
        <div><a class="btn light" href="${support("parts")}">Report an issue</a></div>
      </div>
    </div>
    <script>
      document.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-copy-value]");
        if (!b || !navigator.clipboard) return;
        navigator.clipboard.writeText(b.getAttribute("data-copy-value")).then(function () { b.textContent = "Copied!"; });
      });
    </script>`;

  return renderHub(ctx, "track", "Track My Deck", body);
};
