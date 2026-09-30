import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { portalAllowed, rewardSettings } from "../lib/rewards.server";
import { esc, money, PORTAL_PATH, portalContext, portalPage } from "../lib/portal.server";

// Changes on every deploy so browsers fetch the current script instead of a cached one.
const SCRIPT_VERSION = Date.now().toString(36);

// GET /apps/rewards/r/<code> — a friend opens a customer's referral link. No sign-in needed.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, liquid } = await portalContext(request);
  const code = (params.code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const [referrer, settings] = await Promise.all([
    db.referrerCode.findFirst({ where: { shop, code } }),
    rewardSettings(shop),
  ]);
  const unavailable = liquid(
    portalPage(`<h1>This offer isn't available</h1><p>The referral link may be mistyped or no longer active.</p>
      <p><a class="btn" href="/">Shop A-DIY decks</a></p>`),
  );
  // Soft launch: only testers' links work until the portal is live.
  if (!referrer || !portalAllowed(settings, referrer.customerEmail)) return unavailable;

  const firstName = (referrer.customerName ?? "A friend").split(" ")[0];
  const amount = money(String(settings.referralFriendAmount));
  const config = { api: `${PORTAL_PATH}/api`, code };

  return liquid(
    portalPage(`
      <div class="card" style="max-width:640px;margin:0 auto" id="rw-referral" data-config="${esc(JSON.stringify(config))}">
        <div class="step">A gift from ${esc(firstName)}</div>
        <div class="card-body">
          <h1 style="margin-bottom:8px">${amount} off your A-DIY deck</h1>
          <p>${esc(firstName)} loves their A-DIY deck and wants you to have ${amount} off your first order of
            ${money(String(settings.referralMinOrder))} or more. It works with Pay in 4, 6 or 8 too.</p>
          <label style="display:block;margin:16px 0 8px">Your email<br>
            <input id="rw-friend-email" type="email" autocomplete="email" placeholder="you@example.com"
              style="font:inherit;padding:10px;width:100%;border:1px solid #ccc;border-radius:4px">
          </label>
          <button class="btn" id="rw-claim">Get my ${amount} off</button>
          <p id="rw-claim-msg" class="notice" style="display:none"></p>
          <p class="muted" style="margin-top:14px">For first-time A-DIY customers. Your code works with the email above
            and expires in ${settings.referralCodeDays} days.</p>
        </div>
      </div>
      <script src="${process.env.SHOPIFY_APP_URL}/rewards-portal.js?v=${SCRIPT_VERSION}" defer></script>
    `),
  );
};
