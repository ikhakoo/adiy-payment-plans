// Pieces shared by the hub's three Rewards tabs (Earn, My submissions, Balance & redeem).
import type { RewardType, Submission } from "@prisma/client";
import db from "../db.server";
import { balance } from "./ledger.server";
import { esc, money } from "./portal.server";
import type { PortalOrder } from "./rewards.server";
import type { HubContext } from "./hub.server";

export const REWARD_TABS = [
  { key: "earn", label: "Earn rewards", path: "/rewards" },
  { key: "submissions", label: "My submissions", path: "/rewards/submissions" },
  { key: "balance", label: "Balance & redeem", path: "/rewards/balance" },
] as const;
export type RewardTab = (typeof REWARD_TABS)[number]["key"];

/** The customer's submissions that have been sent for review (drafts are still uploading). */
export const sentSubmissions = (ctx: HubContext) =>
  db.submission.findMany({
    where: { shop: ctx.shop, customerId: ctx.customerId, status: { not: "DRAFT" } },
    include: { rewardType: true },
    orderBy: { createdAt: "desc" },
  });

/** Header, tabs and right-hand column wrapped around one tab's content. */
export async function rewardsLayout(ctx: HubContext, tab: RewardTab, content: string) {
  const bal = await balance(ctx.shop, ctx.customerId);
  const tabs = REWARD_TABS.map(
    (t) => `<a href="${ctx.url(t.path)}"${t.key === tab ? ' class="active" aria-current="page"' : ""}>${t.label}</a>`,
  ).join("");
  return `
    <div class="page-head" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <div>
        <h1 class="h1">Share your deck. Earn rewards.</h1>
        <p class="lede">Show your finished deck and share your honest experience. Positive feedback is not required.</p>
      </div>
      <div class="hide-sm" style="text-align:right"><div class="label">Your rewards</div><div class="h3" style="color:var(--green)">Amazon gift cards</div></div>
    </div>
    <nav class="tabs" aria-label="Rewards">${tabs}</nav>
    <div class="with-aside">
      <div>${content}</div>
      <aside>
        <div class="card balance-card">
          <div class="label">Your reward balance</div>
          <p class="muted" style="margin:4px 0 10px">Your approved rewards</p>
          <div class="big">${money(bal.availableCents / 100)}<small>USD</small></div>
          ${bal.pendingCents ? `<p class="muted" style="margin:8px 0 0">${money(bal.pendingCents / 100)} pending</p>` : ""}
          <a class="btn light" style="width:100%;margin-top:16px" href="${ctx.url("/rewards/balance")}#history">View reward history</a>
        </div>
        <details class="card" style="padding:16px 24px">
          <summary style="cursor:pointer;color:var(--green);font-weight:500">Reward terms &amp; requirements</summary>
          <p class="muted" style="margin:12px 0 0">${esc(ctx.settings.agreementText)}</p>
        </details>
        <div class="card flat">
          <h2 class="h3">Before you submit</h2>
          <p class="muted">A few simple tips to help us review your photos and videos.</p>
          <ul class="tips">
            <li>Show your deck clearly in natural daylight.</li>
            <li>Share what went well and what was challenging.</li>
            <li>Use your phone. No professional equipment needed.</li>
          </ul>
        </div>
      </aside>
    </div>
    <div class="hero" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
      <div>
        <h2 class="h2">Your honest experience matters.</h2>
        <p style="margin:0">Tell us how your build went. Your feedback helps us improve our kits and support other DIY builders.</p>
      </div>
      <span class="pill gold">100% genuine reviews</span>
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

/**
 * What the customer can do with one reward type for one order: the status of what they've sent
 * and/or a button to start, update or retry.
 */
export function tierAction(
  ctx: HubContext,
  order: PortalOrder,
  type: RewardType,
  submissions: WithType[],
  uploadsOpen: boolean,
) {
  const mine = submissions
    .filter((s) => s.orderId === order.id && s.rewardTypeId === type.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = mine[0];
  const used = mine.filter((s) => s.status !== "REJECTED").length;
  const submitUrl = ctx.url(`/submit?order=${order.id.split("/").pop()}&type=${type.id}`);
  const startLabel = `Start ${type.media === "PHOTO" ? "photo set" : type.name.toLowerCase().replace(/^full /, "")}`;

  if (latest?.status === "NEEDS_CHANGES") {
    return `${STATUS_PILL.NEEDS_CHANGES}<span class="muted">${esc(latest.reviewMessage)}</span>
      <a class="btn" href="${submitUrl}">Update submission</a>`;
  }
  if (latest?.status === "PENDING") return STATUS_PILL.PENDING;
  if (latest?.status === "APPROVED" && used >= type.perOrderLimit) {
    return `${STATUS_PILL.APPROVED}<span class="muted">${money(String(latest.amount ?? 0))} earned</span>`;
  }
  if (used >= type.perOrderLimit) return `<span class="pill">Submitted</span>`;
  const rejected =
    latest?.status === "REJECTED" ? `${STATUS_PILL.REJECTED}<span class="muted">${esc(latest.reviewMessage)}</span>` : "";
  return `${rejected}<a class="btn${uploadsOpen ? "" : " disabled"}" href="${submitUrl}">${latest ? "Try again" : esc(startLabel)}</a>`;
}
