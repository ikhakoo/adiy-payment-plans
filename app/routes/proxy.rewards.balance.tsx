import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { esc, money } from "../lib/portal.server";
import { balance, fmtDate, history } from "../lib/ledger.server";
import { asset, hubContext, renderHub } from "../lib/hub.server";
import { figIcon, rewardsLayout, rwIcon, usd } from "../lib/hub-rewards.server";

// GET /apps/hub/rewards/balance — Rewards › Balance & redeem: totals, cash-out and history.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;

  const [bal, events, inReview] = await Promise.all([
    balance(ctx.shop, ctx.customerId),
    history(ctx.shop, ctx.customerId),
    db.submission.count({ where: { shop: ctx.shop, customerId: ctx.customerId, status: "PENDING" } }),
  ]);
  const minCashout = Number(ctx.settings.minCashout);
  const available = bal.availableCents / 100;
  const canCashOut = available >= minCashout;
  const progress = minCashout > 0 ? Math.max(0, Math.min(100, Math.round((available / minCashout) * 100))) : 100;
  const cashoutConfig = {
    api: ctx.url("/api"),
    portal: ctx.url("/rewards/balance"),
    max: available,
    min: minCashout,
  };
  const justCashedOut = new URL(request.url).searchParams.has("cashout");

  const metric = (label: string, ico: Parameters<typeof rwIcon>[0], value: string, sub: string) => `
    <div class="rw-metric">
      <div class="rw-metric-head"><span>${label}</span><i>${rwIcon(ico)}</i></div>
      <b>${value}</b>
      <small>${sub}</small>
    </div>`;

  const historyRows = events
    .map(
      (e) => `<li>
          <div><div class="rw-hist-label">${esc(e.label)}</div><div class="muted">${fmtDate(e.at)} · ${esc(e.status)}</div></div>
          <strong class="${e.amount < 0 ? "" : "rw-plus"}">${e.amount < 0 ? "−" : "+"}${money(Math.abs(e.amount))}</strong>
        </li>`,
    )
    .join("");

  const faq = [
    ["clock", "How long does review take?", "Our team reviews your photos and videos within 2 to 3 business days. We check that your submission meets the program requirements."],
    ["zap", "Does my review need to be positive?", "No. Share your honest experience, including anything you found challenging. Rewards depend on meeting the submission requirements, not positive feedback."],
  ] as const;

  const content = `
    ${justCashedOut ? `<div class="notice"><strong>Request received.</strong> We'll email your Amazon gift card within 2 business days.</div>` : ""}
    <div class="rw-sec-head"><h2 class="h2">Your balance</h2><span class="label">Updated real-time</span></div>
    <div class="rw-metrics">
      ${metric("Available to redeem", "wallet", money(available), "Approved and ready to redeem")}
      ${metric("Pending approval", "clock", money(bal.pendingCents / 100), bal.nextAvailableAt ? `Next available ${fmtDate(bal.nextAvailableAt)}` : "Rewards awaiting review")}
      ${metric("Total redeemed", "receipt", money(bal.sentCents / 100), bal.requestedCents ? `${money(bal.requestedCents / 100)} on its way` : "Gift cards issued so far")}
      ${metric("Submissions in review", "review", `${inReview} <em>${inReview === 1 ? "item" : "items"}</em>`, "Submissions awaiting review")}
    </div>

    <div class="rw-threshold${canCashOut ? " met" : ""}">
      <div>
        <div class="rw-threshold-title">${rwIcon("flag")}Redeem with a balance of ${money(minCashout)} or more.</div>
        <p>${canCashOut ? "You've reached the minimum. You can redeem your balance below." : "Your approved rewards count toward this amount."}</p>
      </div>
      <div class="rw-progress">
        <div class="rw-progress-labels"><span>Current balance: ${money(available)}</span><span>Minimum: ${money(minCashout)}</span></div>
        <div class="rw-meter" role="progressbar" aria-label="Progress to the redeem minimum" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
      </div>
    </div>

    <div class="rw-redeem" id="rw-cashout" data-config="${esc(JSON.stringify(cashoutConfig))}">
      <h2 class="rw-redeem-title">Redeem your Amazon gift card.</h2>
      <p>Once your approved balance reaches ${money(minCashout)}, you can redeem it for an Amazon gift card sent to your email.</p>
      <div class="rw-giftrow">
        <div class="rw-giftinfo">
          ${
            canCashOut
              ? `<label class="rw-gf"><span>Amount ($)</span><input id="rw-amount" type="number" min="${minCashout}" max="${available}" step="1" value="${Math.floor(available)}"></label>
                 <label class="rw-gf"><span>Send to:</span><input id="rw-email" type="email" value="${esc(ctx.email ?? "")}"></label>`
              : `<div class="rw-gf"><span>Send to:</span><b>${esc(ctx.email ?? "The email on your account")}</b></div>`
          }
          <div class="rw-gf"><span>Processing Time:</span><b class="soft">Direct automated dispatch after audit</b></div>
        </div>
        <img class="rw-giftimg" src="${asset("hub-img/rw-amazon-gift-card.png")}" alt="Amazon.com gift card" width="173" height="108" loading="lazy">
      </div>
      <p id="rw-cashout-msg" class="notice warn" style="display:none"></p>
      ${
        canCashOut
          ? `<button class="btn rw-cashout-btn" id="rw-cashout-btn">${figIcon("redeem")}Cash out with Amazon gift card</button>
             <p class="rw-avail">Available balance: ${usd(available)}</p>`
          : `<button class="btn rw-cashout-btn" disabled>${figIcon("redeem")}Cash out with Amazon gift card</button>
             <p class="rw-avail">Available balance: ${usd(available)} · ${usd(minCashout - available)} more needed to redeem</p>`
      }

      <div class="rw-history">
      <h3 class="label rw-sub-label" id="history">Reward history</h3>
      <div class="rw-panel">
        ${historyRows ? `<ul class="rows rw-hist">${historyRows}</ul>` : `<p class="muted rw-hist-empty">${rwIcon("history")}Your approved rewards and gift cards will show here.</p>`}
      </div>
      </div>

      <h3 class="label rw-sub-label">Rewards policy &amp; FAQ</h3>
      <div class="rw-faq">
        ${faq.map(([ico, q, a]) => `<div class="rw-panel"><h4>${rwIcon(ico)}${q}</h4><p>${a}</p></div>`).join("")}
      </div>
    </div>
    <script src="${asset("rewards-portal.js")}" defer></script>`;

  return renderHub(ctx, "rewards", "Rewards", await rewardsLayout(ctx, "balance", content));
};
