import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { portalAllowed, rewardSettings } from "../lib/rewards.server";
import { esc, money, portalContext } from "../lib/portal.server";
import { asset, hubBarePage } from "../lib/hub.server";

// GET /apps/hub/r/<code> — a friend opens a customer's referral link. No sign-in needed.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, liquid, base } = await portalContext(request);
  const code = (params.code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const [referrer, settings] = await Promise.all([
    db.referrerCode.findFirst({ where: { shop, code } }),
    rewardSettings(shop),
  ]);
  const unavailable = liquid(
    hubBarePage(`<div class="card"><h1 class="h1">This offer isn't available</h1>
      <p class="muted">The referral link may be mistyped or no longer active.</p>
      <a class="btn" href="/">Shop A-DIY decks</a></div>`),
  );
  // Soft launch: only testers' links work until the portal is live.
  if (!referrer || !portalAllowed(settings, referrer.customerEmail)) return unavailable;

  const firstName = (referrer.customerName ?? "A friend").split(" ")[0];
  const amount = money(String(settings.referralFriendAmount));
  const config = { api: `${base}/api`, code };

  return liquid(
    hubBarePage(`
      <div class="card" id="rw-referral" data-config="${esc(JSON.stringify(config))}">
        <div>
          <div class="eyebrow">A gift from ${esc(firstName)}</div>
          <h1 class="h1">${amount} off your A-DIY deck</h1>
          <p class="lede">${esc(firstName)} loves their A-DIY deck and wants you to have ${amount} off your first ${
            settings.referralCollectionId ? "A-DIY deck kit" : `order of ${money(String(settings.referralMinOrder))} or more`
          }. It works with Pay in 4, 6 or 8 too.</p>
          <label class="field" style="margin:20px 0 12px">Your email
            <input id="rw-friend-email" type="email" autocomplete="email" placeholder="you@example.com">
          </label>
          <button class="btn" id="rw-claim">Get my ${amount} off</button>
          <p id="rw-claim-msg" class="notice" style="display:none;margin-top:14px"></p>
          <p class="muted" style="margin-top:14px">For first-time A-DIY customers. Your code works with the email above
            and expires in ${settings.referralCodeDays} days.</p>
        </div>
      </div>
      <script src="${asset("rewards-portal.js")}" defer></script>
    `),
  );
};
