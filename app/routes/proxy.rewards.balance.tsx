import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { esc, money } from "../lib/portal.server";
import { balance, fmtDate, history } from "../lib/ledger.server";
import { asset, hubContext, renderHub } from "../lib/hub.server";
import { rewardsLayout } from "../lib/hub-rewards.server";

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
  const progress = Math.min(100, Math.round((available / minCashout) * 100));
  const cashoutConfig = {
    api: ctx.url("/api"),
    portal: ctx.url("/rewards/balance"),
    max: available,
    min: minCashout,
  };
  const justCashedOut = new URL(request.url).searchParams.has("cashout");

  const historyRows = events
    .map(
      (e) => `<li>
          <div><div>${esc(e.label)}</div><div class="muted">${fmtDate(e.at)} · ${esc(e.status)}</div></div>
          <strong style="white-space:nowrap;color:${e.amount < 0 ? "var(--ink)" : "var(--green)"}">${e.amount < 0 ? "−" : "+"}${money(Math.abs(e.amount))}</strong>
        </li>`,
    )
    .join("");

  const content = `
    ${justCashedOut ? `<div class="notice"><strong>Request received.</strong> We'll email your Amazon gift card within 2 business days.</div>` : ""}
    <div class="card-head" style="margin-bottom:12px"><h2 class="h2">Your balance</h2></div>
    <div class="metrics">
      <div class="metric primary"><div class="label">Available to redeem</div><b>${money(available)}</b><span>Approved and ready to redeem</span></div>
      <div class="metric"><div class="label">Pending approval</div><b>${money(bal.pendingCents / 100)}</b>
        <span class="muted">${bal.nextAvailableAt ? `Next available ${fmtDate(bal.nextAvailableAt)}` : "Rewards awaiting review"}</span></div>
      <div class="metric"><div class="label">Total redeemed</div><b>${money(bal.sentCents / 100)}</b>
        <span class="muted">${bal.requestedCents ? `${money(bal.requestedCents / 100)} on its way` : "Gift cards issued so far"}</span></div>
      <div class="metric"><div class="label">Submissions in review</div><b>${inReview}</b><span class="muted">Submissions awaiting review</span></div>
    </div>

    ${
      canCashOut
        ? ""
        : `<div class="card flat">
            <div class="h3">Redeem with a balance of ${money(minCashout)} or more.</div>
            <p class="muted" style="margin:0">Your approved rewards count toward this amount.</p>
            <div class="meter"><span style="width:${progress}%"></span></div>
            <div style="display:flex;justify-content:space-between" class="muted"><span>Current balance: ${money(available)}</span><span>Minimum: ${money(minCashout)}</span></div>
          </div>`
    }

    <div class="card" id="rw-cashout" data-config="${esc(JSON.stringify(cashoutConfig))}">
      <h2 class="h2">Redeem your Amazon gift card.</h2>
      <p class="muted">Once your approved balance reaches ${money(minCashout)}, you can redeem it for an Amazon gift card sent to your email, usually within 2 business days.</p>
      ${
        canCashOut
          ? `<div style="display:grid;grid-template-columns:140px minmax(0,1fr);gap:12px;margin-top:16px">
               <label class="field">Amount ($)<input id="rw-amount" type="number" min="${minCashout}" max="${available}" step="1" value="${Math.floor(available)}"></label>
               <label class="field">Send it to<input id="rw-email" type="email" value="${esc(ctx.email ?? "")}"></label>
             </div>
             <p id="rw-cashout-msg" class="notice warn" style="display:none;margin-top:12px"></p>
             <button class="btn" id="rw-cashout-btn" style="margin-top:16px">Cash out with Amazon gift card</button>`
          : `<button class="btn" disabled style="margin-top:8px">Cash out with Amazon gift card</button>
             <p class="muted" style="margin:10px 0 0">Available balance: ${money(available)} · ${money(minCashout - available)} more needed to redeem</p>`
      }
    </div>

    <div class="card" id="history">
      <h2 class="h2">Reward history</h2>
      ${historyRows ? `<ul class="rows" style="margin-top:8px">${historyRows}</ul>` : `<p class="muted" style="margin:8px 0 0">Your approved rewards and gift cards will show here.</p>`}
    </div>

    <div class="card">
      <div class="label" style="margin-bottom:6px">Rewards policy &amp; FAQ</div>
      <details class="faq"><summary>How long does review take?</summary>
        <p>Our team reviews your photos and videos within 2 to 3 business days. We check that your submission meets the program requirements.</p></details>
      <details class="faq"><summary>Does my review need to be positive?</summary>
        <p>No. Share your honest experience, including anything you found challenging. Rewards depend on meeting the submission requirements, not positive feedback.</p></details>
      <details class="faq"><summary>When can I spend an approved reward?</summary>
        <p>Approved rewards stay pending for ${ctx.settings.holdDays} days, then move to your available balance.</p></details>
    </div>
    <script src="${asset("rewards-portal.js")}" defer></script>`;

  return renderHub(ctx, "rewards", "Rewards", await rewardsLayout(ctx, "balance", content));
};
