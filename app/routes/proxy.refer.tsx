import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { esc, money, storefrontHosts } from "../lib/portal.server";
import { referrerCodeFor } from "../lib/referrals.server";
import { fmtDate } from "../lib/ledger.server";
import { asset, hubContext, renderHub } from "../lib/hub.server";

// GET /apps/hub/refer — Refer a Friend: the customer's link, share options and referral activity.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;
  const { settings } = ctx;
  const friendAmount = money(String(settings.referralFriendAmount));
  const reward = money(String(settings.referralReward));

  // Only customers with an eligible (delivered) order get a link to share.
  let shareCard: string;
  let activity = "";
  if (ctx.rewardOrders.length) {
    const [refCode, hosts, referrals, credited] = await Promise.all([
      referrerCodeFor(ctx.shop, ctx.customerId, ctx.customerName, ctx.email),
      storefrontHosts(ctx.admin, ctx.shop),
      db.referral.findMany({
        where: { shop: ctx.shop, referrerCustomerId: ctx.customerId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.rewardCredit.aggregate({
        where: { shop: ctx.shop, customerId: ctx.customerId, source: "REFERRAL", cancelledAt: null },
        _sum: { amount: true },
      }),
    ]);
    const link = `https://${hosts[1]}${ctx.url(`/r/${refCode.code}`)}`;
    const text = `I love my A-DIY deck. Here's ${friendAmount} off yours:`;
    const enc = encodeURIComponent;
    const shares = [
      ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(link)}`],
      ["SMS", `sms:?&body=${enc(`${text} ${link}`)}`],
      ["Email", `mailto:?subject=${enc(`${friendAmount} off an A-DIY deck`)}&body=${enc(`${text}\n\n${link}`)}`],
      ["WhatsApp", `https://wa.me/?text=${enc(`${text} ${link}`)}`],
    ]
      .map(([label, href]) => `<a class="btn light" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`)
      .join("");
    shareCard = `
      <div class="card">
        <div class="label">Share A-DIY</div>
        <h2 class="h2" style="margin:4px 0 14px">Your personal referral link</h2>
        <div class="share">
          <input id="rw-ref-link" type="text" readonly value="${esc(link)}" aria-label="Your referral link">
          <button class="btn" id="rw-ref-copy">Copy link</button>
          <button class="btn outline" id="rw-ref-share" data-text="${esc(text)}">Share</button>
        </div>
        <div class="label" style="margin:18px 0 8px">Share options</div>
        <div class="btn-row">${shares}</div>
      </div>`;

    const qualifying = referrals.filter((r) => ["ORDERED", "QUALIFIED", "FLAGGED"].includes(r.status)).length;
    const pending = referrals.filter((r) => r.status === "ORDERED" || r.status === "FLAGGED").length;
    const statusText = (r: (typeof referrals)[number]) =>
      ({
        ISSUED: "Has their code, waiting for an order",
        ORDERED: r.qualifiesAt ? `Ordered. Your ${reward} unlocks ${fmtDate(r.qualifiesAt)}` : `Ordered. Your ${reward} unlocks ${settings.referralWaitDays} days after delivery`,
        QUALIFIED: `${reward} earned`,
        FLAGGED: "Ordered. Being reviewed by our team",
        REJECTED: `Didn't qualify${r.rejectReason ? ` (${r.rejectReason.toLowerCase()})` : ""}`,
        EXPIRED: "Code expired unused",
      })[r.status];
    const pillClass = (s: string) => (s === "QUALIFIED" ? "ok" : s === "REJECTED" || s === "EXPIRED" ? "bad" : "");
    const rows = referrals
      .map(
        (r) => `<li><div>${esc(r.friendEmail.replace(/^(.).*(@.*)$/, "$1***$2"))}
          <div class="muted">${fmtDate(r.createdAt)}</div>
          <div style="margin-top:6px"><span class="pill dot ${pillClass(r.status)}" style="white-space:normal">${esc(statusText(r))}</span></div></div></li>`,
      )
      .join("");
    activity = `
      <div class="card">
        <h2 class="h2">Referral activity</h2>
        <ul class="rows" style="margin-top:8px">
          <li><div><div>Qualifying orders</div><div class="muted">Orders placed through your link</div></div><b class="h2">${qualifying}</b></li>
          <li><div><div>Pending rewards</div><div class="muted">Awaiting delivery and the ${settings.referralWaitDays}-day waiting period</div></div><b class="h2">${pending}</b></li>
          <li><div><div>Ready to redeem</div><div class="muted">Approved referral rewards</div></div><b class="h2">${money(Number(credited._sum.amount ?? 0))}</b></li>
        </ul>
        <a class="btn light" style="width:100%;margin-top:12px" href="${ctx.url("/rewards/balance")}">View reward balance</a>
        ${rows ? `<div class="label" style="margin:20px 0 4px">Your friends</div><ul class="rows">${rows}</ul>` : ""}
      </div>`;
  } else {
    shareCard = `<div class="card flat"><h2 class="h3">Your link is on its way</h2>
      <p class="muted" style="margin:0">Once your deck has been delivered, your personal referral link will appear here.</p></div>`;
  }

  const body = `
    <div class="page-head">
      <h1 class="h1">A better backyard, shared.</h1>
      <p class="lede">Know someone planning a deck? Share A-DIY with friends, family or neighbors and earn a reward.</p>
    </div>
    <div class="with-aside">
      <div>
        <div class="hero" style="display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;align-items:center">
          <div style="flex:1;min-width:240px">
            <div class="eyebrow">Craftsman collective</div>
            <h2 class="h1">They get ${friendAmount} off. You earn ${reward}.</h2>
            <p style="margin:0">Your friend saves ${friendAmount} on a qualifying deck order${
              settings.referralCollectionId ? "" : ` of ${money(String(settings.referralMinOrder))} or more`
            }, Pay in 4/6/8 included. Your reward becomes eligible ${settings.referralWaitDays} days after their deck is delivered, subject to program terms.</p>
          </div>
          <div style="background:rgba(255,255,255,.08);border-radius:10px;padding:18px 22px;text-align:center">
            <div class="label" style="color:rgba(255,255,255,.7)">Per qualifying referral</div>
            <div style="font-size:40px;font-weight:500;color:#fff;line-height:1.1">${reward}</div>
            <div class="label" style="color:var(--gold)">Reward credit</div>
          </div>
        </div>
        ${shareCard}
        <div class="card flat">
          <h2 class="h3">Pro tip for builders</h2>
          <p class="muted" style="margin:0">Share a photo of your deck with your referral link. Tell friends about your build and how you use your new space.</p>
        </div>
        <div class="card">
          <div class="label" style="margin-bottom:14px">How it works</div>
          <div class="steps">
            <div><div class="h3">Share your link</div><p class="muted">Send your personal referral link to a friend planning a deck.</p></div>
            <div><div class="h3">They save ${friendAmount}</div><p class="muted">Your friend uses your link to place a qualifying deck order.</p></div>
            <div><div class="h3">You earn ${reward}</div><p class="muted">Your reward becomes eligible ${settings.referralWaitDays} days after delivery, subject to program terms.</p></div>
          </div>
        </div>
      </div>
      <aside>${activity}</aside>
    </div>
    <script src="${asset("rewards-portal.js")}" defer></script>`;

  return renderHub(ctx, "refer", "Refer a Friend", body);
};
