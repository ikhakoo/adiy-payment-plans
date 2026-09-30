import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { eligibleOrders, portalAllowed, rewardSettings, rewardTypes } from "../lib/rewards.server";
import { esc, money, moneyRange, PORTAL_PATH, portalContext, portalPage } from "../lib/portal.server";

// GET /apps/rewards — the customer's rewards home.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, customerId, liquid } = await portalContext(request);

  if (!customerId) {
    return liquid(
      portalPage(`
        <h1>Deck Rewards</h1>
        <p>Share a video or photos of your A-DIY deck and earn Amazon gift cards.</p>
        <p class="muted">Sign in with the email you ordered with. We'll send you a one-time code — no password needed.</p>
        <a class="btn" href="{{ routes.account_login_url }}?return_url=${encodeURIComponent(PORTAL_PATH)}">Sign in</a>
      `),
    );
  }
  if (!admin) return liquid(portalPage(`<h1>Deck Rewards</h1><p>Rewards aren't available right now.</p>`));

  const settings = await rewardSettings(shop);
  const [data, types, submissions, conn] = await Promise.all([
    eligibleOrders(admin, customerId, settings.eligibleDays),
    rewardTypes(shop, { activeOnly: true }),
    db.submission.findMany({ where: { shop, customerId, status: { not: "DRAFT" } } }),
    db.googleConnection.findUnique({ where: { shop } }),
  ]);
  if (!portalAllowed(settings, data?.email)) return liquid(portalPage(`<h1>Deck Rewards</h1><p>Coming soon — share your deck and earn Amazon gift cards.</p>`));
  const uploadsOpen = Boolean(conn?.sharedDriveId);

  const approved = submissions.filter((s) => s.status === "APPROVED");
  const approvedTotal = approved.reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
  const inReview = submissions.filter((s) => s.status === "PENDING").length;

  const orders = data?.orders ?? [];
  const justSubmitted = new URL(request.url).searchParams.has("submitted");
  const orderCards = orders
    .map((o) => {
      const numericId = o.id.split("/").pop();
      const cards = types
        .map((t) => {
          const mine = submissions
            .filter((s) => s.orderId === o.id && s.rewardTypeId === t.id)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          const latest = mine[0];
          const used = mine.filter((s) => s.status !== "REJECTED").length;
          const submitUrl = `${PORTAL_PATH}/submit?order=${numericId}&type=${t.id}`;
          let footer: string;
          if (latest?.status === "NEEDS_CHANGES") {
            footer = `<span class="badge warn">Changes requested</span>
              <p class="muted">${esc(latest.reviewMessage)}</p>
              <a class="btn" href="${submitUrl}">Update submission</a>`;
          } else if (latest?.status === "PENDING") {
            footer = `<span class="badge">In review</span>`;
          } else if (latest?.status === "APPROVED" && used >= t.perOrderLimit) {
            footer = `<span class="badge ok">Approved · ${money(String(latest.amount ?? 0))}</span>`;
          } else if (used >= t.perOrderLimit) {
            footer = `<span class="badge">Submitted</span>`;
          } else {
            const rejected = latest?.status === "REJECTED"
              ? `<span class="badge bad">Not approved</span><p class="muted">${esc(latest.reviewMessage)}</p>`
              : "";
            footer = `${rejected}<a class="btn${uploadsOpen ? "" : " disabled"}" href="${submitUrl}">${latest ? "Try again" : "Submit"}</a>`;
          }
          return `<div class="reward">
              <strong>${esc(t.name)}</strong>
              <span class="amount">${moneyRange(String(t.minAmount), String(t.maxAmount))}</span>
              <span class="muted">${esc(t.description)}</span>
              ${footer}
            </div>`;
        })
        .join("");
      return `<div class="card">
          <div class="step">Order ${esc(o.name)}</div>
          <div class="card-body">
            <div class="order">
              ${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy">` : ""}
              <div><strong>${esc(o.title)}</strong>
                <p class="muted">${o.deliveredAt ? `Delivered ${new Date(o.deliveredAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}</p></div>
            </div>
            <div class="rewards">${cards}</div>
          </div>
        </div>`;
    })
    .join("");

  return liquid(
    portalPage(`
      <h1>Deck Rewards</h1>
      <p>Hi ${esc(data?.name?.split(" ")[0] ?? "there")} — share your deck and earn Amazon gift cards. Every
        submission is reviewed by our team; rewards don't depend on what you say, just that it's clear and genuine.</p>
      <div class="stats">
        <div class="stat">Approved rewards<b>${money(approvedTotal)}</b></div>
        <div class="stat">In review<b>${inReview}</b></div>
      </div>
      ${justSubmitted ? `<div class="notice"><strong>Thanks!</strong> Your submission is in review — we'll email you once our team has looked at it.</div>` : ""}
      ${uploadsOpen ? "" : `<div class="notice">Uploads are paused for a moment — please check back soon.</div>`}
      ${orders.length ? orderCards : `<div class="notice">Once your deck has been delivered, you'll be able to earn rewards for it here.</div>`}
      <p class="muted">Cashing out to an Amazon gift card is coming soon — approved rewards are saved to your account.</p>
    `),
  );
};
