import type { LoaderFunctionArgs } from "react-router";
import { rewardTypes } from "../lib/rewards.server";
import { esc, money } from "../lib/portal.server";
import { asset, hubContext, renderHub } from "../lib/hub.server";
import { sentSubmissions } from "../lib/hub-rewards.server";
import { resourcesUpdated } from "../lib/resources.server";
import { mainLine, orderQuery, orderSwitcher, selectedOrder } from "../lib/orders.server";
import { deckProgress } from "../lib/tracking";
import { carrierLine, GLYPH, liveTrackingUrl, orderNo, progressStrip, STEP_COPY } from "../lib/tracking-view.server";

// GET /apps/hub — Overview: the selected order at a glance, with the next thing to do.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;

  const [{ orders, order }, types, submissions] = await Promise.all([
    selectedOrder(ctx, request),
    rewardTypes(ctx.shop, { activeOnly: true }),
    sentSubmissions(ctx),
  ]);
  // "Updated N days ago" beside View resources: the newest of this kit's build resources.
  const resourcesNote = order ? await resourcesUpdated(ctx.shop, order.lineItems) : null;
  const topReward = types.reduce((max, t) => Math.max(max, Number(t.maxAmount)), 0);
  const possible = types.length * Math.max(1, ctx.rewardOrders.length);
  const sent = submissions.filter((s) => s.status !== "REJECTED").length;
  const p = order ? deckProgress(order) : null;
  const line = order ? mainLine(order) : null;
  const q = orderQuery(order);
  const reportIssue = order ? ctx.url(`/support?topic=parts&order=${order.numericId}`) : ctx.url("/support");

  const STAGE = ["production", "packing", "shipped", "delivered"] as const;
  const stage = p ? STAGE.indexOf(p.step) + 1 : 0;
  const deckImg = `<div class="ov-hero-img" aria-hidden="true"><img src="${asset("hub-img/ov-deck.jpg")}" alt="" loading="eager" width="552" height="599"></div>`;
  const heroBox = (eyebrow: string, title: string, text: string, actions: string) => `<div class="hero ov-hero">
      <div class="ov-hero-text">
        <div class="eyebrow ov-eyebrow">${eyebrow}</div>
        <h2 class="h1">${title}</h2>
        <p>${text}</p>
        ${actions}
      </div>
      ${deckImg}
    </div>`;

  // The hero says what to do next for where the deck is.
  const hero = !order || !p
    ? heroBox(
        "Share your build",
        `Show off your deck.<br>Earn up to ${money(topReward)}.`,
        "Upload a video walkthrough, a short video review or a photo set of your finished deck and earn Amazon gift cards.",
        `<a class="btn white ov-hero-btn" href="${ctx.url("/rewards")}">Explore rewards ${GLYPH.arrow}</a>`,
      )
    : p.step === "delivered"
      ? heroBox(
          "Your next step · Assembly",
          "Your deck has arrived.<br>Let's build.",
          "Everything you need to build your deck is right here. Find your installation guide, footing plan, and interactive 3D instructions below.",
          `<a class="btn white ov-hero-btn" href="${ctx.url(`/resources${q}`)}">View my build resources ${GLYPH.arrow}</a>`,
        )
      : heroBox(
          `Your next step · ${p.step === "shipped" ? "Delivery" : "Get ready"}`,
          STEP_COPY[p.step].title,
          `${STEP_COPY[p.step].text}${p.step === "shipped" ? "" : " While you wait, look through your build resources so you're ready on delivery day."}`,
          `<div class="btn-row">
            <a class="btn white ov-hero-btn" href="${ctx.url(`/track${q}`)}">Track my deck ${GLYPH.arrow}</a>
            ${p.step === "shipped" ? `<a class="btn ov-hero-ghost" href="${esc(liveTrackingUrl(order))}" target="_blank" rel="noopener">Track shipment live</a>` : ""}
          </div>`,
        );

  const progress =
    order && p
      ? `<div class="card ov-progress">
          <div class="ov-progress-head">
            <div class="ov-progress-title">
              <span class="ov-truck">${GLYPH.truck}</span>
              <div><h2 class="h2">Your deck's progress</h2><p>${carrierLine(order, p)}</p></div>
            </div>
            <span class="ov-stage"><i></i>${p.step === "delivered" ? "Stage 4 of 4 completed" : `Stage ${stage} of 4 · ${STEP_COPY[p.step].pill}`}</span>
          </div>
          ${progressStrip(order, p)}
          <div class="ov-progress-foot">
            <span class="ov-note">${GLYPH.pin}<span>${
              p.step === "delivered"
                ? "Your deck has been delivered. Please check all parts within 14 days."
                : p.step === "shipped"
                  ? "Your deck is on its way. The carrier will call you to schedule delivery."
                  : `${p.percent}% of your deck is completed.`
            }</span></span>
            <span class="ov-links">
              <a href="${ctx.url(`/track${q}`)}">View delivery details ${GLYPH.external}</a>
              <i aria-hidden="true">|</i>
              <a class="ov-report" href="${reportIssue}">Report an issue</a>
            </span>
          </div>
        </div>`
      : "";

  const statusPill = p
    ? `<span class="ov-status ${p.step === "delivered" ? "ok" : "warn"}"><i></i>${STEP_COPY[p.step].pill}</span>`
    : "";

  const body = `
    <div class="page-head ov-head">
      <div class="eyebrow">Your deck. All in one place.</div>
      <h1 class="h1">Welcome to your A-DIY Hub${ctx.firstName ? `, ${esc(ctx.firstName)}` : ""}.</h1>
      ${
        order
          ? `<p class="ov-meta">Order ${esc(orderNo(order.name))}${line ? `<i>•</i>${esc(line.title)}${line.variantTitle ? `<i>•</i><b>${esc(line.variantTitle)}</b>` : ""}` : ""}${statusPill ? `<span class="ov-meta-pill">${statusPill}</span>` : ""}</p>`
          : ""
      }
      ${
        order
          ? `<div class="ov-head-row">
              ${statusPill}
              <div class="ov-actions">
                <a class="ov-act" href="${esc(order.statusPageUrl)}" target="_blank" rel="noopener">${GLYPH.receipt}View receipt</a>
                <a class="ov-act" href="${ctx.url(`/invoice?order=${order.numericId}`)}" target="_blank" rel="noopener">${GLYPH.invoice}Download invoice</a>
                <a class="ov-act" href="${ctx.url("/support")}" data-hub-chat>${GLYPH.headset}Message us</a>
              </div>
            </div>`
          : ""
      }
    </div>
    ${orderSwitcher(ctx, "/", orders, order)}
    ${hero}
    ${progress}

    <div class="grid2 ov-grid">
      <div class="card ov-card">
        <div class="ov-card-top">
          <span class="ov-tile">${GLYPH.compass}</span>
          <span class="ov-card-label">Your build resources</span>
        </div>
        <h2 class="h2">Everything you need to build your deck.</h2>
        <p class="ov-card-text">Your installation guide, footing plan, and interactive 3D instructions for your ${line?.variantTitle ? `${esc(line.variantTitle)} ` : ""}deck kit.</p>
        <div class="ov-tags"><span>${GLYPH.check}Installation guide</span><span>${GLYPH.check}Footing plan</span><span>${GLYPH.check}3D instructional app</span></div>
        <div class="spacer"></div>
        <div class="ov-card-foot"><a class="btn ov-btn" href="${ctx.url(`/resources${q}`)}">View resources ${GLYPH.arrow}</a>${
          resourcesNote ? `<span class="ov-foot-note">${resourcesNote}</span>` : ""
        }</div>
      </div>
      <div class="card ov-card">
        <div class="ov-card-top">
          <span class="ov-tile gold">${GLYPH.gift}</span>
          ${topReward ? `<span class="ov-reward-pill">Up to ${money(topReward)} in rewards</span>` : ""}
        </div>
        <h2 class="h2">Share your finished deck.</h2>
        <p class="ov-card-text">Upload a full video walkthrough, a short video review, or a photo set to earn rewards.</p>
        <div class="spacer"></div>
        <div class="ov-subs">
          <div><span>Your submissions</span><b>${Math.min(sent, possible)} of ${possible} submissions</b></div>
          <div class="ov-subs-bar"><span style="width:${possible ? Math.min(100, Math.round((sent / possible) * 100)) : 0}%"></span></div>
        </div>
        <div class="ov-card-foot">
          <a class="ov-btn-soft" href="${ctx.url("/rewards")}">Explore rewards ${GLYPH.gift}</a>
          <span class="ov-foot-note">Instant approval code</span>
        </div>
      </div>
    </div>

    <div class="ov-help">
      <span class="ov-tile">${GLYPH.specialist}</span>
      <div><div class="h3">Need help with your build?</div><p>Our Deck Specialists are here to help with your assembly questions.</p></div>
      <a class="btn ov-btn" href="${ctx.url("/support")}" data-hub-chat>Chat now</a>
    </div>`;

  return renderHub(ctx, "overview", "My DIY Hub", body);
};
