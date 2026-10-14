import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { LIMITS, submissionBlocker } from "../lib/rewards.server";
import { esc, moneyRange } from "../lib/portal.server";
import { asset, hubContext, renderHub } from "../lib/hub.server";

// GET /apps/hub/submit?order=<id>&type=<rewardTypeId> — upload page for one reward.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;
  const { shop, customerId } = ctx;
  const show = (body: string) => renderHub(ctx, "rewards", "Rewards", body);
  const back = `<p><a class="btn link" href="${ctx.url("/rewards")}">← Back to rewards</a></p>`;

  const url = new URL(request.url);
  const numericOrderId = (url.searchParams.get("order") ?? "").replace(/\D/g, "");
  const orderId = `gid://shopify/Order/${numericOrderId}`;
  const settings = ctx.settings;
  const [type, conn] = await Promise.all([
    db.rewardType.findFirst({ where: { id: url.searchParams.get("type") ?? "", shop } }),
    db.googleConnection.findUnique({ where: { shop } }),
  ]);
  const order = ctx.rewardOrders.find((o) => o.id === orderId);
  if (!order || !type) return show(`${back}<div class="notice warn">This order isn't eligible for rewards.</div>`);
  if (!conn?.sharedDriveId) {
    return show(`${back}<div class="notice warn">Uploads are paused for a moment. Please check back soon.</div>`);
  }

  const open = await db.submission.findFirst({
    where: { shop, customerId, orderId, rewardTypeId: type.id, status: { in: ["DRAFT", "NEEDS_CHANGES"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!open) {
    const blocked = await submissionBlocker(shop, orderId, type);
    if (blocked) return show(`${back}<div class="notice warn">${esc(blocked)}</div>`);
  }

  const accept = type.media === "VIDEO" ? "video/*" : type.media === "PHOTO" ? "image/*,.heic,.heif" : "video/*,image/*,.heic,.heif";
  const what = type.media === "VIDEO" ? "videos" : type.media === "PHOTO" ? "photos" : "videos or photos";
  const config = {
    api: ctx.url("/api"),
    portal: ctx.url("/rewards/submissions"),
    orderId: numericOrderId,
    typeId: type.id,
  };

  return show(`
      ${back}
      <div class="page-head">
        <div class="eyebrow">Order ${esc(order.name)}</div>
        <h1 class="h1">${esc(type.name)}</h1>
        <p><span class="pill mint">${moneyRange(String(type.minAmount), String(type.maxAmount))} Amazon gift card</span></p>
        <p class="lede">${esc(type.description)}</p>
      </div>
      ${open?.status === "NEEDS_CHANGES" ? `<div class="notice warn"><strong>Our team asked for changes:</strong> ${esc(open.reviewMessage)}</div>` : ""}

      <div id="rw-upload" data-config="${esc(JSON.stringify(config))}">
        <div class="card"><div class="step-label">1. Add your ${what}</div>
          <label class="drop" id="rw-drop" for="rw-files">
            <input type="file" id="rw-files" multiple accept="${accept}">
            <span class="btn">Choose ${what}</span>
            <span class="muted">or drag them here</span>
            <span class="muted">${
              type.media === "PHOTO"
                ? `Up to ${LIMITS.photosPerSubmission} photos, 25 MB each.`
                : type.media === "VIDEO"
                  ? `Up to ${LIMITS.videosPerSubmission} videos, 2 GB each.`
                  : `Up to ${LIMITS.videosPerSubmission} videos (2 GB each) and ${LIMITS.photosPerSubmission} photos (25 MB each).`
            }${type.media === "PHOTO" ? "" : " Big videos can take a while on mobile data — keep this page open until they finish."}</span>
          </label>
          <ul class="files" id="rw-list"></ul>
        </div>

        <div class="card"><div class="step-label">2. Anything you'd like to add? (optional)</div>
          <textarea id="rw-note" maxlength="2000" placeholder="e.g. We built it over a weekend with two people.">${esc(open?.note ?? "")}</textarea>
        </div>

        <div class="card"><div class="step-label">3. Submit</div>
          <p class="muted">${esc(settings.agreementText)}</p>
          <label class="agree"><input type="checkbox" id="rw-agree"> <span>I agree to the terms above.</span></label>
          <p id="rw-error" class="notice warn" style="display:none"></p>
          <button class="btn" id="rw-submit" disabled>Submit for review</button>
        </div>
      </div>
      <script src="${asset("rewards-upload.js")}" defer></script>
    `);
};
