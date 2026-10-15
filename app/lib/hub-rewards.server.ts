// Pieces shared by the hub's three Rewards tabs (Earn, My submissions, Balance & redeem).
import type { RewardType, Submission } from "@prisma/client";
import db from "../db.server";
import { balance } from "./ledger.server";
import { esc, money } from "./portal.server";
import type { PortalOrder } from "./rewards.server";
import { ARROW, icon, type HubContext } from "./hub.server";

export const REWARD_TABS = [
  { key: "earn", label: "Earn rewards", path: "/rewards" },
  { key: "submissions", label: "My submissions", path: "/rewards/submissions" },
  { key: "balance", label: "Balance & redeem", path: "/rewards/balance" },
] as const;
export type RewardTab = (typeof REWARD_TABS)[number]["key"];

/** Dollars with cents ("$0.00"), where the design shows exact balances. */
export const usd = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(amount);

/** Stroke icons (lucide-style) used across the Rewards and Refer pages. */
export const RW_ICONS = {
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 11 5 12 8c1-3 2.5-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/>',
  photos: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.3-1.3a2.4 2.4 0 0 0-3.4 0L11 18"/><circle cx="12" cy="8" r="2"/><rect x="6" y="2" width="16" height="16" rx="2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  verified: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
  review: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  upload: '<path d="M12 13v8M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="m8 17 4-4 4 4"/>',
} as const;
export const rwIcon = (name: keyof typeof RW_ICONS) => icon(RW_ICONS[name]);

/** The customer's submissions that have been sent for review (drafts are still uploading). */
export const sentSubmissions = (ctx: HubContext) =>
  db.submission.findMany({
    where: { shop: ctx.shop, customerId: ctx.customerId, status: { not: "DRAFT" } },
    include: { rewardType: true },
    orderBy: { createdAt: "desc" },
  });

/** "3 ways to earn rewards" on Earn, "3 Active submission programs open" on the other tabs. */
function programPill(tab: RewardTab, count: number) {
  const text =
    tab === "earn"
      ? `${count} ${count === 1 ? "way" : "ways"} to earn rewards`
      : `${count} Active submission ${count === 1 ? "program" : "programs"} open`;
  return `<span class="rw-count"><i></i>${text}</span>`;
}

/** Header, tabs and right-hand column wrapped around one tab's content. */
export async function rewardsLayout(ctx: HubContext, tab: RewardTab, content: string) {
  const [bal, activeTypes] = await Promise.all([
    balance(ctx.shop, ctx.customerId),
    db.rewardType.count({ where: { shop: ctx.shop, active: true } }),
  ]);
  const tabs = REWARD_TABS.map(
    (t) => `<a href="${ctx.url(t.path)}"${t.key === tab ? ' class="active" aria-current="page"' : ""}>${t.label}</a>`,
  ).join("");
  return `
    <div class="rw-head">
      <div>
        <h1 class="h1">Share your deck. Earn rewards.</h1>
        <p class="lede">Show your finished deck and share your honest experience. Positive feedback is not required.</p>
      </div>
      <div class="rw-ticker">${rwIcon("gift")}<div><span>Your rewards</span><b>Amazon gift cards</b></div></div>
    </div>
    <div class="rw-bar">
      <nav class="tabs rw-tabs" aria-label="Rewards">${tabs}</nav>
      ${activeTypes ? programPill(tab, activeTypes) : ""}
    </div>
    <div class="with-aside rw-layout">
      <div class="rw-main">${content}</div>
      <aside>
        <div class="card rw-balance">
          <div class="label">Your reward balance</div>
          <p>Your approved rewards</p>
          <div class="rw-big">${usd(bal.availableCents / 100)}<small>USD</small></div>
          ${bal.pendingCents ? `<p class="muted rw-pending">${usd(bal.pendingCents / 100)} pending approval</p>` : ""}
          <a class="rw-link rw-link-fill" href="${ctx.url("/rewards/balance")}#history">View reward history${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}</a>
          <details class="rw-terms">
            <summary class="rw-link">Reward Terms &amp; Requirements${rwIcon("chevron")}</summary>
            <p class="muted">${esc(ctx.settings.agreementText)}</p>
          </details>
        </div>
        <div class="card rw-tips">
          <h2 class="h2">${rwIcon("bulb")}Before you submit</h2>
          <p>A few simple tips to help us review your photos and videos.</p>
          <ul>
            <li>${rwIcon("check")}Show your deck clearly in natural daylight.</li>
            <li>${rwIcon("check")}Share what went well and what was challenging.</li>
            <li>${rwIcon("check")}Use your phone. No professional equipment needed.</li>
          </ul>
        </div>
      </aside>
    </div>
    <div class="rw-banner">
      <div class="rw-banner-main">
        <span class="rw-banner-ico">${rwIcon("sparkles")}</span>
        <div>
          <h2 class="h2">Your honest experience matters.</h2>
          <p>Tell us how your build went. Your feedback helps us improve our kits and support other DIY builders.</p>
        </div>
      </div>
      <span class="rw-banner-tag">100% genuine reviews</span>
    </div>`;
}

type WithType = Submission & { rewardType: RewardType };

export const STATUS_PILL: Record<Submission["status"], string> = {
  DRAFT: `<span class="pill">Draft</span>`,
  PENDING: `<span class="pill dot">In review</span>`,
  NEEDS_CHANGES: `<span class="pill warn dot">Changes requested</span>`,
  APPROVED: `<span class="pill ok dot">Approved</span>`,
  REJECTED: `<span class="pill bad dot">Not approved</span>`,
};

/** Icon for a reward type, matching the Figma tiles: walkthrough camera, phone clip, photo set. */
export function rewardIcon(type: RewardType, index: number) {
  if (type.media === "PHOTO") return rwIcon("photos");
  if (type.media === "ANY") return rwIcon("camera");
  return rwIcon(index === 0 ? "video" : "phone");
}

/** Where one order stands for one reward type, and what (if anything) the customer can do next. */
function tierState(ctx: HubContext, order: PortalOrder, type: RewardType, submissions: WithType[]) {
  const mine = submissions
    .filter((s) => s.orderId === order.id && s.rewardTypeId === type.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = mine[0];
  const used = mine.filter((s) => s.status !== "REJECTED").length;
  const url = ctx.url(`/submit?order=${order.id.split("/").pop()}&type=${type.id}`);
  const startLabel = `Start ${type.media === "PHOTO" ? "photo set" : type.name.toLowerCase().replace(/^full /, "")}`;

  if (latest?.status === "NEEDS_CHANGES") {
    return { status: STATUS_PILL.NEEDS_CHANGES, note: esc(latest.reviewMessage), url, label: "Update submission" };
  }
  if (latest?.status === "PENDING") return { status: STATUS_PILL.PENDING, note: "", url: null, label: "" };
  if (latest?.status === "APPROVED" && used >= type.perOrderLimit) {
    return { status: STATUS_PILL.APPROVED, note: `${money(String(latest.amount ?? 0))} earned`, url: null, label: "" };
  }
  if (used >= type.perOrderLimit) return { status: `<span class="pill">Submitted</span>`, note: "", url: null, label: "" };
  if (latest?.status === "REJECTED") {
    return { status: STATUS_PILL.REJECTED, note: esc(latest.reviewMessage), url, label: "Try again" };
  }
  return { status: "", note: "", url, label: startLabel };
}

/**
 * One reward type across the customer's eligible orders: status lines (left column) and a single
 * main call to action (right column). With several orders still open for this reward, the CTA is
 * a small order picker that opens the upload page for the chosen order.
 */
export function tierBlock(
  ctx: HubContext,
  orders: PortalOrder[],
  type: RewardType,
  submissions: WithType[],
  uploadsOpen: boolean,
) {
  const off = uploadsOpen ? "" : " disabled";
  if (!orders.length) {
    return { status: "", cta: `<span class="btn disabled rw-cta">Available once your deck is delivered</span>` };
  }
  const states = orders.map((o) => ({ order: o, ...tierState(ctx, o, type, submissions) }));
  const many = orders.length > 1;
  const status = states
    .filter((s) => s.status)
    .map(
      (s) => `<li>${many ? `<span class="rw-order">Order ${esc(s.order.name)}</span>` : ""}${s.status}${
        s.note ? `<span class="muted">${s.note}</span>` : ""
      }</li>`,
    )
    .join("");
  const open = states.filter((s) => s.url);
  let cta = "";
  if (open.length === 1) {
    const s = open[0];
    cta = `<a class="btn rw-cta${off}" href="${s.url}">${esc(s.label)}${ARROW}</a>${
      many ? `<span class="rw-cta-for">For order ${esc(s.order.name)}</span>` : ""
    }`;
  } else if (open.length > 1) {
    // Plain GET form so it works without JavaScript: /submit?type=…&order=…
    const options = open
      .map((s) => `<option value="${esc(s.order.id.split("/").pop() ?? "")}">Order ${esc(s.order.name)}${s.label === "Update submission" ? " (changes requested)" : ""}</option>`)
      .join("");
    const label = (open.find((s) => s.label.startsWith("Start")) ?? open[0]).label;
    cta = `<form class="rw-pick" method="get" action="${ctx.url("/submit")}">
        <input type="hidden" name="type" value="${esc(type.id)}">
        <select name="order" aria-label="Choose an order for ${esc(type.name)}">${options}</select>
        <button class="btn rw-cta" type="submit"${uploadsOpen ? "" : " disabled"}>${esc(label)}${ARROW}</button>
      </form>`;
  }
  return { status: status ? `<ul class="rw-status">${status}</ul>` : "", cta };
}
