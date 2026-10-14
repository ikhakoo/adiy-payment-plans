import type { LoaderFunctionArgs } from "react-router";
import { esc, money } from "../lib/portal.server";
import { ARROW, hubContext, renderHub } from "../lib/hub.server";
import { fmtDay, orderQuery, orderSwitcher, selectedOrder, type HubOrder } from "../lib/orders.server";

// Whole dollars stay "$5,499"; amounts with cents (installments) show them.
const amount = (n: number) =>
  Number.isInteger(n)
    ? money(n)
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

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

/** Delivery instructions left at checkout: a note attribute that mentions delivery, else the order note. */
function deliveryNote(o: HubOrder) {
  const attr = o.customAttributes.find((a) => /deliver|instruction|gate|drop/i.test(a.key) && a.value?.trim());
  return attr?.value?.trim() || o.note?.trim() || "";
}

function paymentRow(o: HubOrder) {
  const plan = o.plan;
  // Show the order's full total (as on the receipt). A plan's amounts exclude tax and shipping, so
  // only its outstanding balance is used: that's what's still to be charged.
  const total = o.total;
  const remaining = plan ? Number(plan.outstanding) : o.outstanding;
  const paid = plan ? Math.max(0, total - remaining) : o.received;

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
    if (next?.status === "FAILED") {
      detail += `<br><span class="pill warn" style="margin-top:8px;white-space:normal">Last payment didn't go through. We'll retry automatically</span>`;
    }
  } else if (remaining <= 0) {
    detail = esc(o.card ? `Paid in full with ${o.card}` : "Paid in full");
  } else {
    detail = `${esc(amount(remaining))} remaining on this order`;
  }

  return `<div class="ord-pay">
      <div><div class="label">Total</div><b>${esc(amount(total))}</b></div>
      <div><div class="label">Paid</div><b>${esc(amount(paid))}</b></div>
      <div><div class="label">Remaining</div><b>${esc(amount(Math.max(0, remaining)))}</b></div>
    </div>
    <p class="muted" style="margin:10px 0 0">${detail}</p>`;
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
          ${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : `<span class="ord-img"></span>`}
          <div>
            <div class="h3">${esc(l.title)}</div>
            ${l.variantTitle ? `<div class="muted">Size: ${esc(l.variantTitle)}</div>` : ""}
            <div class="label" style="margin-top:6px">Qty: ${l.quantity} ${l.quantity === 1 ? "unit" : "units"}</div>
          </div>
        </div>`,
    )
    .join("");

  const a = order.shippingAddress;
  const note = deliveryNote(order);
  const addressCard = `
    <div class="card">
      <div class="label" style="margin-bottom:10px">Delivery address</div>
      ${
        a
          ? `<address class="ord-address">${[
              a.name,
              a.address1,
              a.address2,
              [a.city, [a.provinceCode, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
              a.countryCodeV2 === "US" ? null : a.countryCodeV2,
              a.phone,
            ]
              .filter(Boolean)
              .map((line) => esc(line))
              .join("<br>")}</address>`
          : `<p class="muted">No delivery address on this order.</p>`
      }
      ${note ? `<div class="label" style="margin:14px 0 4px">Delivery instructions</div><p style="margin:0;font-size:14px">${esc(note)}</p>` : ""}
      <a class="btn link" style="margin-top:16px" href="${ctx.url("/account")}">View account &amp; addresses ${ARROW}</a>
    </div>`;

  const body = `${head}
    <div class="with-aside">
      <div class="card ord-card">
        <div class="card-head">
          <div>
            <div class="eyebrow">Your order</div>
            <h2 class="h2">Order ${esc(order.name)}</h2>
            <div class="muted">Placed ${esc(fmtDay(order.createdAt))}</div>
          </div>
          <span class="pill dot ${status.tone}">${esc(status.label)}</span>
        </div>

        <section class="ord-row">
          <div class="ord-row-label"><div class="label">01 · Product</div><div class="h3">Your deck kit</div></div>
          <div>${items || `<p class="muted">No items on this order.</p>`}</div>
        </section>

        <section class="ord-row">
          <div class="ord-row-label"><div class="label">02 · Payment</div><div class="h3">Payment summary</div></div>
          <div>${paymentRow(order)}</div>
        </section>

        <section class="ord-row">
          <div class="ord-row-label"><div class="label">03 · Documents</div><div class="h3">Order documents</div></div>
          <div>
            <a class="ord-doc" href="${esc(order.statusPageUrl)}" target="_blank" rel="noopener">
              <span><b>Order status &amp; receipt</b><span class="muted">Your order confirmation, items and payments</span></span>${ARROW}
            </a>
          </div>
        </section>

        <div class="btn-row ord-actions">
          <a class="btn" href="${ctx.url("/track" + orderQuery(order))}">View live progress ${ARROW}</a>
          <a class="btn light" href="${ctx.url("/support")}" data-hub-chat>Message us</a>
        </div>
      </div>
      <aside>
        ${addressCard}
        <div class="hero ord-teaser">
          <div class="eyebrow">Ready to build?</div>
          <h2 class="h2">Everything you need to build your deck.</h2>
          <p>Find your installation guide, footing plan, and interactive 3D instructions for your deck kit.</p>
          <a class="btn white" href="${ctx.url("/resources" + orderQuery(order))}">View build resources ${ARROW}</a>
        </div>
      </aside>
    </div>`;

  return renderHub(ctx, "orders", "My Orders", body);
};
