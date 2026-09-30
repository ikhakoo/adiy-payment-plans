import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { eligibleOrders, isTestMode, portalAllowed, rewardSettings, rewardTypes } from "../lib/rewards.server";
import {
  esc,
  money,
  moneyRange,
  PORTAL_PATH,
  portalContext,
  portalPage,
  signInUrl,
  storefrontHosts,
} from "../lib/portal.server";
import { referrerCodeFor } from "../lib/referrals.server";
import { balance, fmtDate, history } from "../lib/ledger.server";

// Changes on every deploy so browsers fetch the current script instead of a cached one.
const SCRIPT_VERSION = Date.now().toString(36);

// GET /apps/rewards — the customer's rewards home.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, customerId, liquid } = await portalContext(request);

  if (!customerId) {
    return liquid(
      portalPage(`
        <h1>Deck Rewards</h1>
        <p>Share a video or photos of your A-DIY deck and earn Amazon gift cards.</p>
        <p class="muted">Sign in with the email you ordered with. We'll send you a one-time code — no password needed.</p>
        <a class="btn" href="${signInUrl(PORTAL_PATH)}">Sign in</a>
      `),
    );
  }
  if (!admin) return liquid(portalPage(`<h1>Deck Rewards</h1><p>Rewards aren't available right now.</p>`));

  const settings = await rewardSettings(shop);
  const [data, types, submissions, conn] = await Promise.all([
    eligibleOrders(admin, customerId, settings.eligibleDays, { testMode: !settings.portalEnabled }),
    rewardTypes(shop, { activeOnly: true }),
    db.submission.findMany({ where: { shop, customerId, status: { not: "DRAFT" } } }),
    db.googleConnection.findUnique({ where: { shop } }),
  ]);
  if (!portalAllowed(settings, data?.email)) return liquid(portalPage(`<h1>Deck Rewards</h1><p>Coming soon — share your deck and earn Amazon gift cards.</p>`));
  const uploadsOpen = Boolean(conn?.sharedDriveId);

  const inReview = submissions.filter((s) => s.status === "PENDING").length;
  const [bal, events] = await Promise.all([balance(shop, customerId), history(shop, customerId)]);
  const minCashout = Number(settings.minCashout);

  // Referral card: only customers with an eligible order get a link to share.
  let referralCard = "";
  if (data?.orders.length) {
    const [refCode, hosts] = await Promise.all([
      referrerCodeFor(shop, customerId, data?.name ?? null, data?.email ?? null),
      storefrontHosts(admin, shop),
    ]);
    const link = `https://${hosts[1]}${PORTAL_PATH}/r/${refCode.code}`;
    const friendAmount = money(String(settings.referralFriendAmount));
    const reward = money(String(settings.referralReward));
    const referrals = await db.referral.findMany({
      where: { shop, referrerCustomerId: customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const statusText = (r: (typeof referrals)[number]) =>
      ({
        ISSUED: "Has their code — waiting for an order",
        ORDERED: r.qualifiesAt
          ? `Ordered — your ${reward} unlocks ${fmtDate(r.qualifiesAt)}`
          : `Ordered — your ${reward} unlocks ${settings.referralWaitDays} days after delivery`,
        QUALIFIED: `${reward} earned`,
        FLAGGED: "Ordered — being reviewed by our team",
        REJECTED: `Didn't qualify${r.rejectReason ? ` (${r.rejectReason.toLowerCase()})` : ""}`,
        EXPIRED: "Code expired unused",
      })[r.status];
    const rows = referrals
      .map(
        (r) => `<li>${esc(r.friendEmail.replace(/^(.).*(@.*)$/, "$1***$2"))}
          <span class="badge${r.status === "QUALIFIED" ? " ok" : r.status === "REJECTED" || r.status === "EXPIRED" ? " bad" : ""}" style="float:right">${esc(statusText(r))}</span></li>`,
      )
      .join("");
    referralCard = `
      <div class="card">
        <div class="step">Refer a friend — they get ${friendAmount} off, you get ${reward}</div>
        <div class="card-body">
          <p>Share your link. Your friend gets ${friendAmount} off their first A-DIY deck${
            settings.referralCollectionId ? "" : ` (orders of ${money(String(settings.referralMinOrder))}+)`
          } — Pay in 4/6/8 included. You get ${reward} in rewards once their deck
            has been delivered for ${settings.referralWaitDays} days.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="rw-ref-link" readonly value="${esc(link)}"
              style="flex:1;min-width:240px;font:inherit;padding:9px;border:1px solid #ccc;border-radius:4px;background:#fafafa">
            <button class="btn" id="rw-ref-copy">Copy link</button>
            <button class="btn secondary" id="rw-ref-share"
              data-text="${esc(`I love my A-DIY deck — here's ${friendAmount} off yours:`)}">Share</button>
          </div>
          ${rows ? `<ul class="files" style="margin-top:16px">${rows}</ul>` : ""}
        </div>
      </div>`;
  }
  const canCashOut = bal.availableCents >= minCashout * 100;
  const cashoutConfig = { api: `${PORTAL_PATH}/api`, portal: PORTAL_PATH, max: bal.availableCents / 100, min: minCashout };
  const historyRows = events
    .map(
      (e) => `<li><span>${fmtDate(e.at)} · ${esc(e.label)}</span>
        <strong style="float:right">${e.amount < 0 ? "−" : "+"}${money(Math.abs(e.amount))}</strong>
        <div class="muted">${esc(e.status)}</div></li>`,
    )
    .join("");

  const orders = data?.orders ?? [];
  const justSubmitted = new URL(request.url).searchParams.has("submitted");
  const justCashedOut = new URL(request.url).searchParams.has("cashout");
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
      ${isTestMode(settings, data?.email) ? `<div class="notice"><strong>Test mode</strong> — the portal isn't live yet. As a tester you can use any of your orders, even unfulfilled ones.</div>` : ""}
      <h1>Deck Rewards</h1>
      <p>Hi ${esc(data?.name?.split(" ")[0] ?? "there")} — share your deck and earn Amazon gift cards. Every
        submission is reviewed by our team; rewards don't depend on what you say, just that it's clear and genuine.</p>
      <div class="stats">
        <div class="stat">Available<b>${money(bal.availableCents / 100)}</b></div>
        <div class="stat">Pending<b>${money(bal.pendingCents / 100)}</b>
          ${bal.nextAvailableAt ? `<span class="muted">Next available ${fmtDate(bal.nextAvailableAt)}</span>` : ""}</div>
        <div class="stat">Cashed out<b>${money(bal.sentCents / 100)}</b>
          ${bal.requestedCents ? `<span class="muted">${money(bal.requestedCents / 100)} on its way</span>` : ""}</div>
        <div class="stat">In review<b>${inReview}</b></div>
      </div>
      ${justCashedOut ? `<div class="notice"><strong>Request received.</strong> We'll email your Amazon gift card within 2 business days.</div>` : ""}
      ${justSubmitted ? `<div class="notice"><strong>Thanks!</strong> Your submission is in review — we'll email you once our team has looked at it.</div>` : ""}
      ${uploadsOpen ? "" : `<div class="notice">Uploads are paused for a moment — please check back soon.</div>`}
      ${orders.length ? orderCards : `<div class="notice">Once your deck has been delivered, you'll be able to earn rewards for it here.</div>`}
      <div class="card" id="rw-cashout" data-config="${esc(JSON.stringify(cashoutConfig))}">
        <div class="step">Cash out to an Amazon gift card</div>
        <div class="card-body">
          ${
            canCashOut
              ? `<p>We'll email an Amazon eGift card for the amount you choose — usually within 2 business days.</p>
                 <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
                   <label>Amount ($)<br><input id="rw-amount" type="number" min="${minCashout}" max="${bal.availableCents / 100}" step="1"
                     value="${Math.floor(bal.availableCents / 100)}" style="font:inherit;padding:9px;width:140px;border:1px solid #ccc;border-radius:4px"></label>
                   <label style="flex:1;min-width:220px">Send it to<br><input id="rw-email" type="email" value="${esc(data?.email ?? "")}"
                     style="font:inherit;padding:9px;width:100%;border:1px solid #ccc;border-radius:4px"></label>
                   <button class="btn" id="rw-cashout-btn">Request gift card</button>
                 </div>
                 <p id="rw-cashout-msg" class="notice" style="display:none"></p>`
              : `<p class="muted">You can cash out once you have at least ${money(minCashout)} available.</p>`
          }
        </div>
      </div>

      ${referralCard}
      ${historyRows ? `<div class="card"><div class="step">History</div><div class="card-body"><ul class="files">${historyRows}</ul></div></div>` : ""}
      <script src="${process.env.SHOPIFY_APP_URL}/rewards-portal.js?v=${SCRIPT_VERSION}" defer></script>
    `),
  );
};
