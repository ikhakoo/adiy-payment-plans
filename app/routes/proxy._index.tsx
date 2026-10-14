import type { LoaderFunctionArgs } from "react-router";
import { rewardTypes } from "../lib/rewards.server";
import { esc, money } from "../lib/portal.server";
import { ARROW, hubContext, icon, renderHub } from "../lib/hub.server";
import { sentSubmissions } from "../lib/hub-rewards.server";
import { mainLine, orderQuery, orderSwitcher, selectedOrder } from "../lib/orders.server";
import { carrierTrackingUrl, deckProgress } from "../lib/tracking";
import { progressStrip, STEP_COPY } from "../lib/tracking-view.server";

// GET /apps/hub — Overview: the selected order at a glance, with the next thing to do.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;

  const [{ orders, order }, types, submissions] = await Promise.all([
    selectedOrder(ctx, request),
    rewardTypes(ctx.shop, { activeOnly: true }),
    sentSubmissions(ctx),
  ]);
  const topReward = types.reduce((max, t) => Math.max(max, Number(t.maxAmount)), 0);
  const possible = types.length * Math.max(1, ctx.rewardOrders.length);
  const sent = submissions.filter((s) => s.status !== "REJECTED").length;
  const friendAmount = money(String(ctx.settings.referralFriendAmount));
  const reward = money(String(ctx.settings.referralReward));
  const p = order ? deckProgress(order) : null;
  const line = order ? mainLine(order) : null;
  const q = orderQuery(order);
  const reportIssue = order ? ctx.url(`/support?topic=parts&order=${order.numericId}`) : ctx.url("/support");

  // The hero says what to do next for where the deck is.
  const hero = !order || !p
    ? `<div class="hero">
        <div class="eyebrow">Share your build</div>
        <h2 class="h1">Show off your deck.<br>Earn up to ${money(topReward)}.</h2>
        <p>Upload a video walkthrough, a short video review or a photo set of your finished deck and earn Amazon gift cards.</p>
        <a class="btn white" href="${ctx.url("/rewards")}">Explore rewards ${ARROW}</a>
      </div>`
    : p.step === "delivered"
      ? `<div class="hero">
          <div class="eyebrow">Your next step · Assembly</div>
          <h2 class="h1">Your deck has arrived.<br>Let's build.</h2>
          <p>Everything you need to build your deck is right here. Find your installation guide, footing plan, and interactive 3D instructions below.</p>
          <a class="btn white" href="${ctx.url(`/resources${q}`)}">View my build resources ${ARROW}</a>
        </div>`
      : `<div class="hero">
          <div class="eyebrow">Your next step · ${p.step === "shipped" ? "Delivery" : "Get ready"}</div>
          <h2 class="h1">${STEP_COPY[p.step].title}</h2>
          <p>${STEP_COPY[p.step].text}${p.step === "shipped" ? "" : " While you wait, look through your build resources so you're ready on delivery day."}</p>
          <div class="btn-row">
            <a class="btn white" href="${ctx.url(`/track${q}`)}">Track my deck ${ARROW}</a>
            ${p.step === "shipped" ? `<a class="btn outline" href="${esc(carrierTrackingUrl(order.name))}" target="_blank" rel="noopener">Track shipment live</a>` : ""}
          </div>
        </div>`;

  const progress =
    order && p
      ? `<div class="card">
          <div class="card-head">
            <div><h2 class="h2">Your deck's progress</h2><p class="muted" style="margin:0">Order ${esc(order.name)}${p.step === "shipped" || p.step === "delivered" ? " · LTL freight" : ""}</p></div>
            <span class="pill">${STEP_COPY[p.step].pill}</span>
          </div>
          ${progressStrip(order, p)}
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px;align-items:center">
            <span class="muted">${p.step === "delivered" ? "Your deck has been delivered. Please check all parts within 14 days." : `${p.percent}% of your deck is completed.`}</span>
            <span class="btn-row"><a class="btn link" href="${ctx.url(`/track${q}`)}">View delivery details ${ARROW}</a>
              ${p.step === "delivered" ? `<a class="btn link" href="${reportIssue}">Report an issue</a>` : ""}</span>
          </div>
        </div>`
      : "";

  const body = `
    <div class="page-head" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <div>
        <div class="eyebrow">Your deck. All in one place.</div>
        <h1 class="h1">Welcome to your A-DIY Hub${ctx.firstName ? `, ${esc(ctx.firstName)}` : ""}.</h1>
        ${order ? `<p class="muted" style="font-size:14px;margin:0">Order ${esc(order.name)}${line ? ` · ${esc(line.title)}${line.variantTitle ? ` · ${esc(line.variantTitle)}` : ""}` : ""}</p>` : ""}
      </div>
      ${
        order
          ? `<div class="btn-row"><a class="btn light" href="${esc(order.statusPageUrl)}" target="_blank" rel="noopener">View receipt</a>
              <a class="btn light" href="${ctx.url("/support")}" data-hub-chat>Message us</a></div>`
          : ""
      }
    </div>
    ${orderSwitcher(ctx, "/", orders, order)}
    ${hero}
    ${progress}

    <div class="grid2">
      <div class="card">
        <div class="card-head">
          <div class="icon-tile" style="margin:0">${icon('<path d="M12 3 4 21M12 3l8 18M7.5 13h9"/>')}</div>
          <span class="label">Your build resources</span>
        </div>
        <h2 class="h2">Everything you need to build your deck.</h2>
        <p class="muted" style="font-size:14px">Your installation guide, footing plan, and interactive 3D instructions for your deck kit.</p>
        <div class="btn-row" style="margin-bottom:16px"><span class="pill">✓ Installation guide</span><span class="pill">✓ Footing plan</span><span class="pill">✓ 3D instructional app</span></div>
        <div class="spacer"></div>
        <div><a class="btn" href="${ctx.url(`/resources${q}`)}">View resources ${ARROW}</a></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div class="icon-tile" style="margin:0">${icon('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>')}</div>
          ${topReward ? `<span class="pill mint">Up to ${money(topReward)} in rewards</span>` : ""}
        </div>
        <h2 class="h2">Share your finished deck.</h2>
        <p class="muted" style="font-size:14px">Upload a full video walkthrough, a short video review, or a photo set to earn rewards.</p>
        <div class="spacer"></div>
        <div class="card flat" style="padding:12px 14px;margin:8px 0 16px">
          <div style="display:flex;justify-content:space-between" class="label"><span>Your submissions</span><span>${Math.min(sent, possible)} of ${possible}</span></div>
          <div class="meter"><span style="width:${possible ? Math.min(100, Math.round((sent / possible) * 100)) : 0}%"></span></div>
        </div>
        <div><a class="btn light" href="${ctx.url("/rewards")}">Explore rewards</a></div>
      </div>
    </div>

    <div class="banner">
      <div class="icon-tile" style="margin:0;background:#fff">${icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>')}</div>
      <div><div class="h3">A better backyard, shared.</div><p>Your friend gets ${friendAmount} off their deck. You earn ${reward} once it's been delivered for ${ctx.settings.referralWaitDays} days.</p></div>
      <a class="btn light" href="${ctx.url("/refer")}">Refer a friend</a>
    </div>
    <div class="banner">
      <div class="icon-tile" style="margin:0;background:#fff">${icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>')}</div>
      <div><div class="h3">Need help with your build?</div><p>Our Deck Specialists are here to help with your assembly questions.</p></div>
      <a class="btn" href="${ctx.url("/support")}" data-hub-chat>Chat now</a>
    </div>`;

  return renderHub(ctx, "overview", "My DIY Hub", body);
};
