import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { esc, money, storefrontHosts } from "../lib/portal.server";
import { referrerCodeFor } from "../lib/referrals.server";
import { asset, hubContext, icon, renderHub } from "../lib/hub.server";
import { rwIcon, usd } from "../lib/hub-rewards.server";

const I = {
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  sms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  whatsapp: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  analytics: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
};
// Facebook's mark is a filled glyph, so it can't use the stroke icon() helper.
const FACEBOOK = `<svg viewBox="0 0 22 21" aria-hidden="true"><path fill="currentColor" d="M21.03 10.51C21.03 4.71 16.32 0 10.51 0 4.71 0 0 4.71 0 10.51c0 5.09 3.62 9.33 8.41 10.31v-7.15h-2.1v-3.16h2.1V7.88c0-2.03 1.65-3.68 3.68-3.68h2.63v3.15h-2.1c-.58 0-1.05.48-1.05 1.06v2.1h3.15v3.16h-3.15V21c5.31-.53 9.46-5.01 9.46-10.49Z"/></svg>`;

// GET /apps/hub/refer — Refer a Friend: the customer's link, share options and referral activity.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;
  const { settings } = ctx;
  const friendAmount = money(String(settings.referralFriendAmount));
  const reward = money(String(settings.referralReward));

  const [referrals, credited] = await Promise.all([
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

  // Only customers with an eligible (delivered) order get a link to share.
  let shareCard: string;
  if (ctx.rewardOrders.length) {
    const [refCode, hosts] = await Promise.all([
      referrerCodeFor(ctx.shop, ctx.customerId, ctx.customerName, ctx.email),
      storefrontHosts(ctx.admin, ctx.shop),
    ]);
    const link = `https://${hosts[1]}${ctx.url(`/r/${refCode.code}`)}`;
    const text = `I love my A-DIY deck. Here's ${friendAmount} off yours:`;
    const enc = encodeURIComponent;
    const shares = [
      ["Facebook", FACEBOOK, `https://www.facebook.com/sharer/sharer.php?u=${enc(link)}`],
      ["SMS", icon(I.sms), `sms:?&body=${enc(`${text} ${link}`)}`],
      ["Email", icon(I.mail), `mailto:?subject=${enc(`${friendAmount} off an A-DIY deck`)}&body=${enc(`${text}\n\n${link}`)}`],
      ["WhatsApp", icon(I.whatsapp), `https://wa.me/?text=${enc(`${text} ${link}`)}`],
    ]
      .map(([label, svg, href]) => `<a class="ref-chip" href="${esc(href)}" target="_blank" rel="noopener">${svg}${label}</a>`)
      .join("");
    shareCard = `
      <div class="card ref-card">
        <div class="label">Share A-DIY</div>
        <h2 class="ref-title">Your personal referral link</h2>
        <div class="ref-linkbox">
          <span class="ref-lock">${icon(I.lock)}</span>
          <input id="rw-ref-link" type="text" readonly value="${esc(link)}" aria-label="Your referral link">
          <button class="btn ref-copy" id="rw-ref-copy" data-label="Copy link">${icon(I.copy)}<span>Copy link</span></button>
        </div>
        <div class="label ref-opts-label">Share options</div>
        <div class="ref-chips">
          <button class="ref-chip" type="button" data-rw-copy data-label="Copy link">${icon(I.link)}<span>Copy link</span></button>
          ${shares}
          <button class="ref-chip" type="button" id="rw-ref-share" data-text="${esc(text)}">${icon(I.share)}<span>More</span></button>
        </div>
      </div>`;
  } else {
    shareCard = `
      <div class="card ref-card">
        <div class="label">Share A-DIY</div>
        <h2 class="ref-title">Your link is on its way</h2>
        <p class="muted" style="margin:0">Once your deck has been delivered, your personal referral link will appear here.</p>
      </div>`;
  }

  const qualifying = referrals.filter((r) => ["ORDERED", "QUALIFIED", "FLAGGED"].includes(r.status)).length;
  const pending = referrals.filter((r) => r.status === "ORDERED" || r.status === "FLAGGED").length;
  const stat = (cls: string, ico: string, title: string, sub: string, value: string) => `
    <div class="ref-stat${cls}">
      <span class="ref-stat-ico">${ico}</span>
      <div><div class="ref-stat-title">${title}</div><div class="ref-stat-sub">${sub}</div></div>
      <b>${value}</b>
    </div>`;

  const activity = `
    <div class="card ref-card ref-dash">
      <div class="ref-dash-head">
        <div><div class="label">Dashboard</div><h2 class="ref-title">Referral activity</h2></div>
        <span class="ref-dash-ico">${icon(I.analytics)}</span>
      </div>
      <div class="ref-stats">
        ${stat("", icon(I.cart), "Qualifying orders", "Orders placed through your link", String(qualifying))}
        ${stat("", rwIcon("clock"), "Pending rewards", `Awaiting delivery and the ${settings.referralWaitDays}-day waiting period`, String(pending))}
        ${stat(" ready", rwIcon("wallet"), "Ready to redeem", "Approved referral rewards", usd(Number(credited._sum.amount ?? 0)))}
      </div>
      <a class="btn light ref-balance-btn" href="${ctx.url("/rewards/balance")}">${rwIcon("wallet")}View reward balance</a>
    </div>`;

  const steps = [
    ["Share your link", "Send your personal referral link to a friend planning a deck."],
    [`They save ${friendAmount}`, "Your friend uses your link to place a qualifying deck order."],
    [`You earn ${reward}`, `Your reward becomes eligible ${settings.referralWaitDays} days after delivery, subject to program terms.`],
  ];

  const body = `
    <div class="page-head ref-head">
      <h1 class="h1">A better backyard, shared.</h1>
      <p class="lede">Know someone planning a deck?<br>Share A-DIY with friends, family, or neighbors and earn a reward.</p>
    </div>
    <div class="hero ref-hero">
      <div class="ref-hero-text">
        <div class="eyebrow">${rwIcon("verified")}Craftsman collective</div>
        <h2 class="ref-hero-title">They get ${friendAmount} off. You earn ${reward}.</h2>
        <p>Your friend saves ${friendAmount} on a qualifying deck order${
          settings.referralCollectionId ? "" : ` of ${money(String(settings.referralMinOrder))} or more`
        }. Your reward becomes eligible ${settings.referralWaitDays} days after their deck is delivered, subject to program terms.</p>
      </div>
      <div class="ref-hero-box">
        <div class="label">Per qualifying referral</div>
        <b>${reward}</b>
        <span>Direct Credit</span>
      </div>
    </div>
    <div class="ref-grid">
      <div class="ref-col">
        ${shareCard}
        <div class="ref-tip">
          <span class="ref-tip-ico">${rwIcon("bulb")}</span>
          <div><h2 class="h3">Pro tip for builders</h2>
          <p>Share a photo of your deck with your referral link. Tell friends about your build and how you use your new space.</p></div>
        </div>
        <figure class="ref-gallery">
          <img src="${asset("hub-img/ref-gallery.jpg")}" alt="A finished A-DIY deck with outdoor seating at dusk" loading="lazy" width="792" height="288">
          <figcaption><span>Inspiration gallery</span><b>Real customer decks</b></figcaption>
        </figure>
      </div>
      <div class="ref-col">
        ${activity}
        <div class="card ref-card ref-how">
          <div class="label">How it works</div>
          <ol>${steps.map(([t, d], i) => `<li><i>${i + 1}</i><div><b>${t}</b><span>${d}</span></div></li>`).join("")}</ol>
        </div>
      </div>
    </div>
    <script src="${asset("rewards-portal.js")}" defer></script>`;

  return renderHub(ctx, "refer", "Refer a Friend", body);
};
