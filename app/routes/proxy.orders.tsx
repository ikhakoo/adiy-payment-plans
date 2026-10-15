import type { LoaderFunctionArgs } from "react-router";
import { esc } from "../lib/portal.server";
import { ARROW, hubContext, icon, renderHub } from "../lib/hub.server";
import {
  HUB_ICONS as I,
  cents,
  deliveryNote,
  fmtDay,
  orderQuery,
  orderSwitcher,
  paymentTotals,
  selectedOrder,
  type HubOrder,
} from "../lib/orders.server";

/** Customer-facing status from Shopify's fulfillment status and the shipments' tracking. */
function orderStatus(o: HubOrder): { label: string; tone: string } {
  const shipments = o.fulfillments.filter((f) => f.status !== "CANCELLED" && f.displayStatus !== "CANCELED");
  const delivered =
    shipments.length > 0 &&
    shipments.every((f) => f.deliveredAt || f.displayStatus === "DELIVERED" || f.displayStatus === "PICKED_UP");
  if (o.displayFulfillmentStatus === "FULFILLED" && delivered) return { label: "Delivered", tone: "ok" };
  if (shipments.some((f) => f.displayStatus === "OUT_FOR_DELIVERY")) return { label: "Out for delivery", tone: "mint" };
  if (o.displayFulfillmentStatus === "PARTIALLY_FULFILLED") return { label: "Partially shipped", tone: "mint" };
  if (shipments.length) return { label: "Shipped", tone: "mint" };
  if (o.displayFulfillmentStatus === "ON_HOLD") return { label: "On hold", tone: "warn" };
  return { label: "Processing", tone: "gold" };
}

function paymentRow(o: HubOrder) {
  const plan = o.plan;
  const amount = (n: number) => cents(n, o.currency);
  // The order's full total (as on the receipt). A plan's amounts exclude tax and shipping, so only
  // its outstanding balance is used: that's what's still to be charged.
  const { total, paid, remaining } = paymentTotals(o);

  let detail: string;
  if (plan) {
    const made = plan.installments.filter((i) => i.status === "PAID").length;
    const next = plan.installments.find((i) => ["SCHEDULED", "PROCESSING", "FAILED"].includes(i.status));
    const parts = [`Pay in ${plan.installmentsCount}`, `${made} of ${plan.installmentsCount} payments made`];
    if (plan.status === "COMPLETED" || !next) parts.push("Paid in full");
    else {
      // A failed payment is retried on nextAttemptAt, which is then the real next charge.
      const when = next.status === "FAILED" && next.nextAttemptAt ? next.nextAttemptAt : next.dueDate;
      parts.push(`Next payment ${fmtDay(when)} · ${amount(Number(next.amount))}`);
    }
    detail = esc(parts.join(" · "));
  } else if (remaining <= 0) {
    detail = esc(o.card ? `Paid in full with ${o.card}` : "Paid in full");
  } else {
    detail = `${esc(amount(remaining))} remaining on this order`;
  }
  const failed = plan?.installments.some((i) => i.status === "FAILED");

  return `<div class="ord-pay-line">
      <span>Total: <b>${esc(amount(total))}</b></span>
      <i aria-hidden="true">/</i>
      <span>Paid: <b class="ord-paid">${esc(amount(paid))}</b></span>
      <i aria-hidden="true">/</i>
      <span>Remaining: <b>${esc(amount(remaining))}</b></span>
    </div>
    <p class="ord-pay-detail">${icon(I.card)}<span>${detail}</span></p>
    ${failed ? `<span class="pill warn ord-pay-warn">Last payment didn't go through. We'll retry automatically</span>` : ""}`;
}

/** Address lines for the delivery card. */
function addressHtml(o: HubOrder) {
  const a = o.shippingAddress;
  if (!a) return `<p class="muted" style="margin:0">No delivery address on this order.</p>`;
  const lines = [
    a.address1,
    a.address2,
    [a.city, [a.provinceCode, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    a.countryCodeV2 === "US" ? null : a.countryCodeV2,
  ].filter(Boolean);
  return `${a.name ? `<div class="ord-addr-name">${esc(a.name)}</div>` : ""}
    <address class="ord-addr-lines">${lines.map((l) => `<span>${esc(l)}</span>`).join("")}</address>
    ${a.phone ? `<div class="ord-addr-phone">${esc(a.phone)}</div>` : ""}`;
}

// GET /apps/hub/orders — My Orders: one order's kit, payment summary, documents and delivery address.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;
  const { orders, order } = await selectedOrder(ctx, request);

  const head = `
    <div class="page-head ord-head">
      <div>
        <h1 class="h1">Your order details.</h1>
        <p class="lede">View your deck kit, payment details, and order documents.</p>
      </div>
      ${orderSwitcher(ctx, "/orders", orders, order)}
    </div>`;

  if (!order) {
    return renderHub(
      ctx,
      "orders",
      "My Orders",
      `${head}
      <div class="card" style="text-align:center;padding:40px 24px">
        <div class="ord-tile" style="margin:0 auto 14px">${icon(I.box)}</div>
        <h2 class="h2">No orders yet</h2>
        <p class="muted" style="max-width:420px;margin:0 auto 18px">When you order a deck kit with ${esc(ctx.email ?? "this account")}, it will show up here with its payment details and documents.</p>
        <a class="btn" href="/">Shop deck kits</a>
      </div>`,
    );
  }

  const status = orderStatus(order);
  const items = order.lineItems
    .map(
      (l) => `<div class="ord-item">
          ${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : `<span class="ord-img">${icon(I.box)}</span>`}
          <div class="ord-item-text">
            <div class="ord-item-title">${esc(l.title)}</div>
            ${l.variantTitle ? `<div class="ord-item-size">Size: ${esc(l.variantTitle)}</div>` : ""}
          </div>
          <span class="ord-qty">Qty: ${l.quantity} ${l.quantity === 1 ? "unit" : "units"}</span>
        </div>`,
    )
    .join("");

  const q = orderQuery(order);
  const invoiceUrl = ctx.url(`/invoice${q}`);
  const receiptUrl = ctx.url(`/invoice${q}${q ? "&" : "?"}view=receipt`);
  const doc = (href: string, ico: string, label: string, trail: string, hint: string) =>
    `<a class="ord-doc-btn" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(hint)}">${icon(ico)}<span>${esc(label)}</span>${icon(trail)}</a>`;

  const note = deliveryNote(order);

  const body = `${head}
    <div class="card ord-card">
      <div class="ord-card-head">
        <div class="ord-id">
          <span class="ord-tile">${icon(I.box)}</span>
          <div>
            <div class="label">Your order</div>
            <h2 class="ord-title">Order ${esc(order.name)}</h2>
          </div>
        </div>
        <div class="ord-meta">
          <span class="ord-status ${status.tone}">${esc(status.label)}</span>
          <span class="ord-date">${esc(fmtDay(order.createdAt))}</span>
        </div>
      </div>

      <div class="ord-rows">
        <section class="ord-row">
          <div class="ord-row-label"><div class="label">01 · Product</div><div class="ord-row-title">Your deck kit</div></div>
          <div class="ord-items">${items || `<p class="muted">No items on this order.</p>`}</div>
        </section>

        <section class="ord-row">
          <div class="ord-row-label"><div class="label">02 · Payment</div><div class="ord-row-title">Payment summary</div></div>
          <div>${paymentRow(order)}</div>
        </section>

        <section class="ord-row">
          <div class="ord-row-label"><div class="label">03 · Archival</div><div class="ord-row-title">Order documents</div></div>
          <div class="ord-docs">
            ${doc(invoiceUrl, I.fileText, `Invoice ${order.name}`, I.download, "Printable invoice: save it as a PDF from the print dialog")}
            ${doc(order.statusPageUrl, I.fileCheck, "Order confirmation", I.external, "Your order status page from checkout")}
            ${doc(receiptUrl, I.receipt, "Receipts & tax details", I.download, "Payments received and tax breakdown, printable")}
          </div>
        </section>
      </div>

      <div class="ord-actions">
        <a class="btn ord-btn" href="${ctx.url("/track" + q)}">${icon(I.truck)}View live progress</a>
        <a class="btn light ord-btn" href="${ctx.url("/support")}" data-hub-chat>${icon(I.headset)}Message us</a>
      </div>
    </div>

    <div class="ord-bottom">
      <div class="card ord-delivery">
        <h2 class="ord-delivery-title">${icon(I.pin)}Delivery address</h2>
        <p class="ord-delivery-sub">The delivery address and instructions for this order.</p>
        <div class="ord-addr">
          ${addressHtml(order)}
          ${
            note
              ? `<p class="ord-addr-note">${icon(I.check)}<span><b>Delivery instructions:</b> ${esc(note)}</span></p>`
              : `<p class="ord-addr-note muted">${icon(I.info)}<span>No delivery instructions were added to this order.</span></p>`
          }
        </div>
        <a class="btn light ord-addr-btn" href="${ctx.url("/account")}">View account &amp; addresses ${ARROW}</a>
      </div>
      <div class="ord-teaser">
        <div class="ord-teaser-eyebrow">${icon(I.tools)}Ready to build?</div>
        <h2 class="ord-teaser-title">Everything you need to build your deck.</h2>
        <p>Find your installation guide, footing plan, and interactive 3D instructions for your deck kit.</p>
        <a class="btn white" href="${ctx.url("/resources" + q)}">View build resources</a>
      </div>
    </div>`;

  return renderHub(ctx, "orders", "My Orders", body);
};
