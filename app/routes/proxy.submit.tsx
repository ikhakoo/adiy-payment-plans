import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { eligibleOrders, LIMITS, portalAllowed, rewardSettings, submissionBlocker } from "../lib/rewards.server";
import { esc, moneyRange, PORTAL_PATH, portalContext, portalPage, signInUrl } from "../lib/portal.server";

// Changes on every deploy so browsers fetch the current uploader instead of a cached one.
const SCRIPT_VERSION = Date.now().toString(36);

// GET /apps/rewards/submit?order=<id>&type=<rewardTypeId> — upload page for one reward.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, customerId, liquid } = await portalContext(request);
  const back = `<p><a href="${PORTAL_PATH}">← Back to Deck Rewards</a></p>`;
  if (!customerId || !admin) {
    const here = new URL(request.url);
    const returnTo = `${PORTAL_PATH}/submit${here.search.replace(/[?&](shop|logged_in_customer_id|path_prefix|timestamp|signature)=[^&]*/g, "").replace(/^&/, "?")}`;
    return liquid(
      portalPage(`${back}<p>Please sign in to submit content.</p><a class="btn" href="${esc(signInUrl(returnTo))}">Sign in</a>`),
    );
  }

  const url = new URL(request.url);
  const numericOrderId = (url.searchParams.get("order") ?? "").replace(/\D/g, "");
  const orderId = `gid://shopify/Order/${numericOrderId}`;
  const settings = await rewardSettings(shop);
  const [data, type, conn] = await Promise.all([
    eligibleOrders(admin, customerId, settings.eligibleDays, { testMode: !settings.portalEnabled }),
    db.rewardType.findFirst({ where: { id: url.searchParams.get("type") ?? "", shop } }),
    db.googleConnection.findUnique({ where: { shop } }),
  ]);
  if (!portalAllowed(settings, data?.email)) return liquid(portalPage(`<h1>Deck Rewards</h1><p>Coming soon — share your deck and earn Amazon gift cards.</p>`));
  const order = data?.orders.find((o) => o.id === orderId);
  if (!order || !type) return liquid(portalPage(`${back}<p>This order isn't eligible for rewards.</p>`));
  if (!conn?.sharedDriveId) {
    return liquid(portalPage(`${back}<div class="notice">Uploads are paused for a moment — please check back soon.</div>`));
  }

  const open = await db.submission.findFirst({
    where: { shop, customerId, orderId, rewardTypeId: type.id, status: { in: ["DRAFT", "NEEDS_CHANGES"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!open) {
    const blocked = await submissionBlocker(shop, orderId, type);
    if (blocked) return liquid(portalPage(`${back}<div class="notice">${esc(blocked)}</div>`));
  }

  const accept = type.media === "VIDEO" ? "video/*" : type.media === "PHOTO" ? "image/*,.heic,.heif" : "video/*,image/*,.heic,.heif";
  const what = type.media === "VIDEO" ? "videos" : type.media === "PHOTO" ? "photos" : "videos or photos";
  const config = {
    api: `${PORTAL_PATH}/api`,
    portal: PORTAL_PATH,
    orderId: numericOrderId,
    typeId: type.id,
  };

  return liquid(
    portalPage(`
      ${back}
      <h1>${esc(type.name)}</h1>
      <p><span class="badge ok">${moneyRange(String(type.minAmount), String(type.maxAmount))} Amazon gift card</span>
         <span class="muted">· Order ${esc(order.name)}</span></p>
      <p>${esc(type.description)}</p>
      ${open?.status === "NEEDS_CHANGES" ? `<div class="notice"><strong>Our team asked for changes:</strong> ${esc(open.reviewMessage)}</div>` : ""}

      <div id="rw-upload" data-config="${esc(JSON.stringify(config))}">
        <div class="card"><div class="step">1. Add your ${what}</div><div class="card-body">
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
        </div></div>

        <div class="card"><div class="step">2. Anything you'd like to add? (optional)</div><div class="card-body">
          <textarea id="rw-note" maxlength="2000" placeholder="e.g. We built it over a weekend with two people.">${esc(open?.note ?? "")}</textarea>
        </div></div>

        <div class="card"><div class="step">3. Submit</div><div class="card-body">
          <p class="muted">${esc(settings.agreementText)}</p>
          <label class="agree"><input type="checkbox" id="rw-agree"> <span>I agree to the terms above.</span></label>
          <p id="rw-error" class="notice" style="display:none"></p>
          <button class="btn" id="rw-submit" disabled>Submit for review</button>
        </div></div>
      </div>
      <script src="${process.env.SHOPIFY_APP_URL}/rewards-upload.js?v=${SCRIPT_VERSION}" defer></script>
    `),
  );
};
