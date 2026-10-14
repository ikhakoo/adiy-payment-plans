import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { rewardTypes } from "../lib/rewards.server";
import { esc, moneyRange } from "../lib/portal.server";
import { hubContext, renderHub } from "../lib/hub.server";
import { rewardsLayout, sentSubmissions, tierAction } from "../lib/hub-rewards.server";

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
  const orders = ctx.rewardOrders;

  const tiers = types
    .map((t, i) => {
      // One order: a single button. Several: one line per order so each can be submitted separately.
      const actions = !orders.length
        ? `<a class="btn disabled">Available once your deck is delivered</a>`
        : orders.length === 1
          ? tierAction(ctx, orders[0], t, submissions, uploadsOpen)
          : orders
              .map((o) => `<div class="order-status"><span class="label">Order ${esc(o.name)}</span>${tierAction(ctx, o, t, submissions, uploadsOpen)}</div>`)
              .join("");
      return `<div class="tier">
          <div>
            <h3 class="h2" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${esc(t.name)}${i === 0 ? '<span class="pill gold">Top reward</span>' : ""}</h3>
            <p class="muted" style="font-size:14px;margin:0">${esc(t.description)}</p>
          </div>
          <div class="amount"><b>${moneyRange(String(t.minAmount), String(t.maxAmount))}</b><span class="label">Amazon gift card</span></div>
          <div class="actions">${actions}</div>
        </div>`;
    })
    .join("");

  const justSubmitted = new URL(request.url).searchParams.has("submitted");
  const content = `
    ${justSubmitted ? `<div class="notice"><strong>Thanks!</strong> Your submission is in review. We'll email you once our team has looked at it.</div>` : ""}
    ${uploadsOpen ? "" : `<div class="notice warn">Uploads are paused for a moment. Please check back soon.</div>`}
    <div class="card">
      <div class="card-head"><span class="pill mint">${types.length} ways to earn rewards</span></div>
      ${tiers || `<p class="muted">There are no rewards to earn right now.</p>`}
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:14px;margin-top:4px">
        <span class="muted">Amazon gift card rewards are subject to review and program terms.</span>
        <span class="muted">Payouts in ~48 hrs</span>
      </div>
    </div>`;

  return renderHub(ctx, "rewards", "Rewards", await rewardsLayout(ctx, "earn", content));
};
