import type { LoaderFunctionArgs } from "react-router";
import { esc, money } from "../lib/portal.server";
import { fmtDate } from "../lib/ledger.server";
import { hubContext, renderHub } from "../lib/hub.server";
import { rewardsLayout, sentSubmissions, STATUS_PILL } from "../lib/hub-rewards.server";

// GET /apps/hub/rewards/submissions — Rewards › My submissions: everything sent for review.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;

  const submissions = await sentSubmissions(ctx);
  const justSubmitted = new URL(request.url).searchParams.has("submitted");

  const rows = submissions
    .map((s) => {
      const submitUrl = ctx.url(`/submit?order=${s.orderId.split("/").pop()}&type=${s.rewardTypeId}`);
      const detail =
        s.status === "APPROVED"
          ? `${money(String(s.amount ?? 0))} earned`
          : s.status === "PENDING"
            ? "Our team reviews submissions within 2 to 3 business days."
            : esc(s.reviewMessage);
      return `<li>
          <div>
            <div class="h3">${esc(s.rewardType.name)}</div>
            <div class="muted">Order ${esc(s.orderName)} · Sent ${fmtDate(s.submittedAt ?? s.createdAt)}</div>
            ${detail ? `<div class="muted" style="margin-top:4px">${detail}</div>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
            ${STATUS_PILL[s.status]}
            ${s.status === "NEEDS_CHANGES" ? `<a class="btn" href="${submitUrl}">Update</a>` : ""}
          </div>
        </li>`;
    })
    .join("");

  const content = `
    ${justSubmitted ? `<div class="notice"><strong>Thanks!</strong> Your submission is in review. We'll email you once our team has looked at it.</div>` : ""}
    ${
      rows
        ? `<div class="card"><div class="card-head"><h2 class="h2">Your submissions</h2>
             <span class="pill">${submissions.length} sent</span></div><ul class="rows">${rows}</ul></div>`
        : `<div class="card" style="text-align:center;padding:48px 24px">
             <h2 class="h2">No files uploaded yet</h2>
             <p class="muted" style="max-width:420px;margin:0 auto 18px">Pick a reward to submit your video walkthrough, short clip or photo set and start earning gift card credit.</p>
             <a class="btn" href="${ctx.url("/rewards")}">Explore rewards</a>
           </div>`
    }`;

  return renderHub(ctx, "rewards", "Rewards", await rewardsLayout(ctx, "submissions", content));
};
