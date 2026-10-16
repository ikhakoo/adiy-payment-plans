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

/** Figma's own (filled, Material-style) glyphs where testers compared icons one-to-one. */
const FIG_ICONS = {
  video: ["0 0 30 24", "M2.93 23.51C2.13 23.51 1.43 23.23 0.86 22.65C0.28 22.07 0 21.38 0 20.57V2.93C0 2.13 0.28 1.43 0.86 0.86C1.43 0.28 2.13 0 2.93 0H20.57C21.38 0 22.07 0.28 22.65 0.86C23.23 1.43 23.51 2.13 23.51 2.93V9.55L29.39 3.67V19.84L23.51 13.96V20.57C23.51 21.38 23.23 22.07 22.65 22.65C22.07 23.23 21.38 23.51 20.57 23.51H2.93ZM2.93 20.57H20.57V2.93H2.93V20.57Z"],
  phone: ["0 0 23 33", "M2.93 32.33C2.13 32.33 1.43 32.05 0.86 31.47C0.28 30.89 0 30.20 0 29.39V2.93C0 2.13 0.28 1.43 0.86 0.86C1.43 0.28 2.13 0 2.93 0H17.63C18.44 0 19.13 0.28 19.71 0.86C20.29 1.43 20.57 2.13 20.57 2.93V7.49C21.01 7.66 21.37 7.93 21.64 8.30C21.91 8.67 22.04 9.08 22.04 9.55V12.49C22.04 12.95 21.91 13.37 21.64 13.74C21.37 14.11 21.01 14.38 20.57 14.55V29.39C20.57 30.20 20.29 30.89 19.71 31.47C19.13 32.05 18.44 32.33 17.63 32.33H2.93ZM2.93 29.39H17.63V2.93H2.93V29.39ZM10.28 7.34C10.70 7.34 11.05 7.20 11.33 6.92C11.61 6.64 11.75 6.29 11.75 5.87C11.75 5.46 11.61 5.11 11.33 4.83C11.05 4.55 10.70 4.40 10.28 4.40C9.87 4.40 9.52 4.55 9.24 4.83C8.96 5.11 8.81 5.46 8.81 5.87C8.81 6.29 8.96 6.64 9.24 6.92C9.52 7.20 9.87 7.34 10.28 7.34Z"],
  photos: ["0 0 30 30", "M10.28 17.63H24.98L19.91 11.02L16.53 15.43L14.25 12.49L10.28 17.63ZM8.81 23.51C8.01 23.51 7.31 23.23 6.74 22.65C6.16 22.07 5.87 21.38 5.87 20.57V2.93C5.87 2.13 6.16 1.43 6.74 0.86C7.31 0.28 8.01 0 8.81 0H26.45C27.26 0 27.95 0.28 28.53 0.86C29.11 1.43 29.39 2.13 29.39 2.93V20.57C29.39 21.38 29.11 22.07 28.53 22.65C27.95 23.23 27.26 23.51 26.45 23.51H8.81ZM8.81 20.57H26.45V2.93H8.81V20.57ZM2.93 29.39C2.13 29.39 1.43 29.11 0.86 28.53C0.28 27.95 0 27.26 0 26.45V5.87H2.93V26.45H23.51V29.39H2.93Z"],
  badge: ["0 0 25 24", "M8.37 23.15L6.28 19.62L2.31 18.74L2.70 14.66L0 11.57L2.70 8.48L2.31 4.40L6.28 3.52L8.37 0L12.12 1.59L15.87 0L17.96 3.52L21.93 4.40L21.55 8.48C21.55 8.48 24.25 9.97 24.25 11.57C24.25 13.17 21.55 14.66 21.55 14.66L21.93 18.74L17.96 19.62L15.87 23.15L12.12 21.55L8.37 23.15ZM9.31 20.33L12.12 19.12L14.99 20.33L16.53 17.69L19.56 16.97L19.29 13.89L21.33 11.57L19.29 9.20L19.56 6.11L16.53 5.45L14.93 2.81L12.12 4.02L9.26 2.81L7.71 5.45L4.68 6.11L4.96 9.20L2.92 11.57L4.96 13.89L4.68 17.03L7.71 17.69L9.31 20.33ZM10.96 15.48L17.19 9.26L15.65 7.66L10.96 12.34L8.59 10.03L7.05 11.57L10.96 15.48Z"],
  redeem: ["0 0 17 16", "M1.66 12.5V14.16H15V12.5H1.66ZM1.66 3.33H3.5C3.43 3.20 3.38 3.07 3.36 2.93C3.34 2.79 3.33 2.65 3.33 2.5C3.33 1.80 3.57 1.21 4.06 0.72C4.54 0.24 5.13 0 5.83 0C6.25 0 6.63 0.10 6.98 0.32C7.34 0.53 7.65 0.80 7.91 1.12L8.33 1.66L8.75 1.12C9 0.79 9.30 0.52 9.66 0.31C10.02 0.10 10.41 0 10.83 0C11.52 0 12.11 0.24 12.60 0.72C13.09 1.21 13.33 1.80 13.33 2.5C13.33 2.65 13.32 2.79 13.30 2.93C13.28 3.07 13.23 3.20 13.16 3.33H15C15.45 3.33 15.85 3.49 16.17 3.82C16.50 4.14 16.66 4.54 16.66 5V14.16C16.66 14.62 16.50 15.01 16.17 15.34C15.85 15.67 15.45 15.83 15 15.83H1.66C1.20 15.83 0.81 15.67 0.48 15.34C0.16 15.01 0 14.62 0 14.16V5C0 4.54 0.16 4.14 0.48 3.82C0.81 3.49 1.20 3.33 1.66 3.33ZM1.66 10H15V5H10.75L12.5 7.37L11.16 8.33L8.33 4.5L5.5 8.33L4.16 7.37L5.87 5H1.66V10ZM5.83 3.33C6.06 3.33 6.26 3.25 6.42 3.09C6.58 2.93 6.66 2.73 6.66 2.5C6.66 2.26 6.58 2.06 6.42 1.90C6.26 1.74 6.06 1.66 5.83 1.66C5.59 1.66 5.39 1.74 5.23 1.90C5.07 2.06 5 2.26 5 2.5C5 2.73 5.07 2.93 5.23 3.09C5.39 3.25 5.59 3.33 5.83 3.33ZM10.83 3.33C11.06 3.33 11.26 3.25 11.42 3.09C11.58 2.93 11.66 2.73 11.66 2.5C11.66 2.26 11.58 2.06 11.42 1.90C11.26 1.74 11.06 1.66 10.83 1.66C10.59 1.66 10.39 1.74 10.23 1.90C10.07 2.06 10 2.26 10 2.5C10 2.73 10.07 2.93 10.23 3.09C10.39 3.25 10.59 3.33 10.83 3.33Z"],
} as const;
export const figIcon = (name: keyof typeof FIG_ICONS) =>
  `<svg viewBox="${FIG_ICONS[name][0]}" fill="currentColor" aria-hidden="true"><path d="${FIG_ICONS[name][1]}"/></svg>`;

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
      <div class="rw-ticker">${figIcon("redeem")}<div><span>Your rewards</span><b>Amazon gift cards</b></div></div>
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
          <a class="rw-link rw-link-fill rw-desk" href="${ctx.url("/rewards/balance")}#history">View reward history${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}</a>
          <a class="rw-link rw-link-fill rw-phone" href="${ctx.url("/rewards/balance")}">View reward history${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}</a>
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

const isWalkthrough = (type: RewardType) => /walk-?through/i.test(type.name);

/** Icon for a reward type, matching the Figma tiles: walkthrough camera, phone clip, photo set. */
export function rewardIcon(type: RewardType, index: number) {
  if (type.media === "PHOTO") return figIcon("photos");
  if (type.media === "ANY") return rwIcon("camera");
  return figIcon(isWalkthrough(type) || index === 0 ? "video" : "phone");
}

/** Figma's CTA labels, from the reward's media (the type's name is merchant copy and can be long). */
function startLabel(type: RewardType) {
  if (type.media === "PHOTO") return "Start photo set";
  if (type.media === "ANY") return "Start submission";
  return isWalkthrough(type) ? "Start walkthrough" : "Start video review";
}

/** Where one order stands for one reward type, and what (if anything) the customer can do next. */
function tierState(ctx: HubContext, order: PortalOrder, type: RewardType, submissions: WithType[]) {
  const mine = submissions
    .filter((s) => s.orderId === order.id && s.rewardTypeId === type.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = mine[0];
  const used = mine.filter((s) => s.status !== "REJECTED").length;
  const url = ctx.url(`/submit?order=${order.id.split("/").pop()}&type=${type.id}`);

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
  return { status: "", note: "", url, label: startLabel(type) };
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
