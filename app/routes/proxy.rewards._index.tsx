import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { rewardTypes } from "../lib/rewards.server";
import { esc, moneyRange } from "../lib/portal.server";
import { hubContext, renderHub } from "../lib/hub.server";
import { rewardIcon, rewardsLayout, rwIcon, sentSubmissions, tierBlock } from "../lib/hub-rewards.server";

// GET /apps/hub/rewards — Rewards › Earn rewards: the ways to earn, and where each order stands.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;

  const [types, submissions, conn] = await Promise.all([
    rewardTypes(ctx.shop, { activeOnly: true }),
    sentSubmissions(ctx),
    db.googleConnection.findUnique({ where: { shop: ctx.shop } }),
  ]);
  const uploadsOpen = Boolean(conn?.sharedDriveId);

  const tiers = types
    .map((t, i) => {
      const { status, cta } = tierBlock(ctx, ctx.rewardOrders, t, submissions, uploadsOpen);
      return `<div class="rw-tier">
          <span class="rw-tile">${rewardIcon(t, i)}</span>
          <div class="rw-tier-text">
            <h3 class="h3">${esc(t.name)}${i === 0 ? '<span class="rw-top">Top reward</span>' : ""}</h3>
            <p>${esc(t.description)}</p>
            ${status}
          </div>
          <div class="rw-tier-side">
            <b class="rw-amount">${moneyRange(String(t.minAmount), String(t.maxAmount))}</b>
            <span class="label">Amazon gift card</span>
            <div class="rw-tier-cta">${cta}</div>
          </div>
        </div>
        <div class="rw-rule" aria-hidden="true"></div>`;
    })
    .join("");

  const justSubmitted = new URL(request.url).searchParams.has("submitted");
  const content = `
    ${justSubmitted ? `<div class="notice"><strong>Thanks!</strong> Your submission is in review. We'll email you once our team has looked at it.</div>` : ""}
    ${uploadsOpen ? "" : `<div class="notice warn">Uploads are paused for a moment. Please check back soon.</div>`}
    <div class="card rw-tiers">
      ${tiers || `<p class="muted">There are no rewards to earn right now.</p>`}
      <div class="rw-note">
        <span>${rwIcon("verified")}<span>Amazon gift card rewards<br>Subject to review and program terms.</span></span>
        <b>Payouts in ~48 hrs</b>
      </div>
    </div>`;

  return renderHub(ctx, "rewards", "Rewards", await rewardsLayout(ctx, "earn", content));
};
