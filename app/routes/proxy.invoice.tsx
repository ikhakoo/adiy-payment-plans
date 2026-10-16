import type { LoaderFunctionArgs } from "react-router";
import { esc } from "../lib/portal.server";
import { hubContext, icon } from "../lib/hub.server";
import {
  HUB_ICONS as I,
  cents,
  fmtDay,
  hubInvoice,
  hubOrders,
  invoiceNumber,
  orderLabel,
  type HubAddress,
  type HubInvoice,
} from "../lib/orders.server";

// GET /apps/hub/invoice?order=<numeric id>[&view=receipt] — a printable invoice (or payment receipt
// with the tax breakdown) for one of the signed-in customer's own orders. Served as a standalone
// HTML page (not Liquid), so it prints cleanly without the store theme around it.

const STYLE = `
:root { --green:#194636; --green-2:#3b6755; --mint:#bdedd6; --gold:#d4af37; --ink:#1b1b1b; --text:#414944; --muted:#5d5f5f; --line:#e8e8e8; --soft:#f3f3f3; --page:#f9f9f9; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text); font: 15px/1.5 "Outfit", system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--green); }
svg { width: 16px; height: 16px; flex: none; }
.bar { max-width: 860px; margin: 0 auto; padding: 20px 16px 0; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.bar nav { display: flex; gap: 6px; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--green); background: var(--green); color: #fff; border-radius: 7px; padding: 10px 16px;
  font: inherit; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; text-decoration: none; cursor: pointer; }
.btn.light { background: #fff; border-color: var(--line); color: var(--ink); }
.btn.on { background: var(--soft); border-color: var(--soft); color: var(--green); }
.sheet { max-width: 860px; margin: 16px auto 48px; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 40px; }
.top { display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 12px; }
.brand i { width: 40px; height: 40px; border-radius: 7px; background: var(--green); color: var(--gold); display: grid; place-items: center; font-style: normal; font-weight: 700; font-size: 18px; }
.brand b { display: block; color: var(--ink); font-size: 17px; font-weight: 600; }
.brand small { color: var(--muted); font-size: 13px; }
h1 { margin: 0 0 4px; color: var(--ink); font-size: 28px; font-weight: 500; letter-spacing: -.01em; text-align: right; }
.facts { margin: 0; display: grid; grid-template-columns: auto auto; gap: 2px 14px; font-size: 13px; justify-content: end; }
.facts dt { color: var(--muted); text-align: right; }
.facts dd { margin: 0; color: var(--ink); font-weight: 500; }
.label { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.addrs { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 24px 0; border-bottom: 1px solid var(--line); }
address { font-style: normal; color: var(--ink); font-size: 14px; line-height: 1.6; }
table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 14px; }
th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 0 0 10px; border-bottom: 1px solid var(--line); }
td { padding: 14px 0; border-bottom: 1px solid var(--line); vertical-align: top; color: var(--ink); }
td small { display: block; color: var(--muted); font-size: 12px; }
th.num, td.num { text-align: right; white-space: nowrap; padding-left: 16px; }
.totals { margin: 20px 0 0 auto; width: min(100%, 340px); font-size: 14px; }
.totals div { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; }
.totals div span:last-child { color: var(--ink); white-space: nowrap; }
.totals .grand { border-top: 1px solid var(--line); margin-top: 6px; padding-top: 12px; font-size: 17px; font-weight: 600; color: var(--ink); }
.totals .paid span:last-child { color: var(--green); font-weight: 600; }
.totals .due { background: var(--soft); border-radius: 7px; padding: 8px 10px; margin-top: 6px; font-weight: 600; }
.note { margin-top: 28px; padding: 14px 16px; background: var(--soft); border-radius: 8px; font-size: 13px; color: var(--text); }
.foot { margin-top: 28px; font-size: 12px; color: var(--muted); text-align: center; }
.empty { color: var(--muted); font-size: 14px; padding: 14px 0; }
@media (max-width: 600px) {
  .sheet { padding: 22px 16px; border-radius: 0; border-left: 0; border-right: 0; }
  .top { flex-direction: column; }
  h1, .facts dt { text-align: left; }
  .facts { justify-content: start; }
  .addrs { grid-template-columns: 1fr; }
  .hide-sm { display: none; }
}
@media print {
  body { background: #fff; }
  .bar { display: none; }
  .sheet { border: 0; margin: 0; padding: 0; max-width: none; }
  a { color: inherit; text-decoration: none; }
}`;

function page(title: string, body: string) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap">
<style>${STYLE}</style>
</head>
<body>${body}</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}

const COUNTRY: Record<string, string> = { US: "United States", CA: "Canada" };

function address(a: (HubAddress & { company?: string | null }) | null) {
  if (!a) return `<span class="empty">Not provided</span>`;
  return `<address>${[
    a.name,
    a.company,
    a.address1,
    a.address2,
    [a.city, [a.provinceCode, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    a.countryCodeV2 ? (COUNTRY[a.countryCodeV2] ?? a.countryCodeV2) : null,
    a.phone,
  ]
    .filter(Boolean)
    .map((l) => esc(l))
    .join("<br>")}</address>`;
}

function invoiceBody(inv: HubInvoice, receipt: boolean, links: { invoice: string; receipt: string; back: string }) {
  const m = (n: number) => esc(cents(n, inv.currency));
  const o = inv.order;
  const docTitle = receipt ? "Receipt" : "Invoice";

  const bar = `<div class="bar">
      <a class="btn light" href="${esc(links.back)}">${icon(I.arrowLeft)}My Orders</a>
      <nav aria-label="Document">
        <a class="btn ${receipt ? "light" : "on"}" href="${esc(links.invoice)}"${receipt ? "" : ' aria-current="page"'}>Invoice</a>
        <a class="btn ${receipt ? "on" : "light"}" href="${esc(links.receipt)}"${receipt ? ' aria-current="page"' : ""}>Receipt &amp; taxes</a>
        <button class="btn" type="button" onclick="window.print()">${icon(I.printer)}Print / Save as PDF</button>
      </nav>
    </div>`;

  const top = `<div class="top">
      <div class="brand"><i>A</i><div><b>${esc(inv.shopName)}</b>${inv.shopEmail ? `<small>${esc(inv.shopEmail)}</small>` : ""}</div></div>
      <div>
        <h1>${receipt ? "Receipt" : `Invoice ${esc(invoiceNumber(o))}`}</h1>
        <dl class="facts">
          <dt>Invoice no.</dt><dd>${esc(invoiceNumber(o))}</dd>
          <dt>Order</dt><dd>${esc(orderLabel(o))}</dd>
          <dt>Order date</dt><dd>${esc(fmtDay(o.createdAt))}</dd>
          ${receipt ? "" : `<dt>Issued</dt><dd>${esc(fmtDay(new Date()))}</dd>`}
        </dl>
      </div>
    </div>`;

  const addrs = `<div class="addrs">
      <div><div class="label">Billed to</div>${address(inv.billingAddress)}</div>
      <div><div class="label">Ship to</div>${address(inv.shippingAddress)}</div>
    </div>`;

  const taxRows = inv.taxLines.length
    ? inv.taxLines
        .map(
          (t) =>
            `<div><span>${esc(t.title)}${t.rate != null ? ` (${esc(Number(t.rate.toFixed(3)))}%)` : ""}${inv.taxesIncluded ? " · included" : ""}</span><span>${m(t.amount)}</span></div>`,
        )
        .join("")
    : `<div><span>Tax</span><span>${m(inv.tax)}</span></div>`;

  const totals = `<div class="totals">
      <div><span>Items</span><span>${m(inv.itemsTotal)}</span></div>
      ${inv.discounts > 0 ? `<div><span>Discounts${inv.discountCodes.length ? ` (${esc(inv.discountCodes.join(", "))})` : ""}</span><span>−${m(inv.discounts)}</span></div>` : ""}
      <div><span>Shipping${inv.shippingTitle ? ` · ${esc(inv.shippingTitle)}` : ""}</span><span>${m(inv.shipping)}</span></div>
      ${taxRows}
      <div class="grand"><span>Total</span><span>${m(inv.total)}</span></div>
      ${inv.refunded > 0 ? `<div><span>Refunded</span><span>−${m(inv.refunded)}</span></div>` : ""}
      <div class="paid"><span>Paid to date</span><span>${m(inv.paid)}</span></div>
      <div class="due"><span>${inv.remaining > 0 ? "Balance remaining" : "Balance due"}</span><span>${m(inv.remaining)}</span></div>
    </div>`;

  const plan = o.plan
    ? `<p class="note">This order is on a Pay in ${o.plan.installmentsCount} payment plan. "Paid to date" includes the plan payments made so far; the remaining balance is charged on the plan's schedule.</p>`
    : "";

  let main: string;
  if (receipt) {
    const rows = inv.payments
      .map(
        (p) =>
          `<tr><td>${esc(fmtDay(p.date))}</td><td>${esc(p.kind)}<small>${esc(p.method)}</small></td><td class="num">${p.kind === "Refund" ? "−" : ""}${m(p.amount)}</td></tr>`,
      )
      .join("");
    const taxTable = inv.taxLines.length
      ? inv.taxLines
          .map(
            (t) =>
              `<tr><td>${esc(t.title)}</td><td class="num">${t.rate != null ? `${esc(Number(t.rate.toFixed(3)))}%` : "—"}</td><td class="num">${m(t.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3" class="empty">No tax was charged on this order.</td></tr>`;
    main = `
      <table>
        <thead><tr><th>Date</th><th>Payment</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3" class="empty">No payments have been recorded on this order yet.</td></tr>`}</tbody>
      </table>
      <table>
        <thead><tr><th>Tax${inv.taxesIncluded ? " (included in prices)" : ""}</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${taxTable}</tbody>
      </table>
      ${totals}`;
  } else {
    const rows = inv.lines
      .map(
        (l) =>
          `<tr><td>${esc(l.title)}${l.variantTitle ? `<small>${esc(l.variantTitle)}</small>` : ""}${l.sku ? `<small>SKU ${esc(l.sku)}</small>` : ""}</td><td class="num">${l.quantity}</td><td class="num hide-sm">${m(l.unit)}</td><td class="num">${m(l.total)}</td></tr>`,
      )
      .join("");
    main = `
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num hide-sm">Unit price</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No items on this order.</td></tr>`}</tbody>
      </table>
      ${totals}`;
  }

  return `${bar}
    <main class="sheet">
      ${top}
      ${addrs}
      ${main}
      ${plan}
      <p class="foot">Questions about this ${docTitle.toLowerCase()}? Message us from your A-DIY Hub${inv.shopEmail ? ` or email ${esc(inv.shopEmail)}` : ""}.</p>
    </main>`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page: gate, ctx } = await hubContext(request);
  if (gate) return gate;

  const params = new URL(request.url).searchParams;
  const wanted = params.get("order")?.replace(/\D/g, "") ?? "";
  const receipt = params.get("view") === "receipt";
  // Only ever one of this customer's own orders: never fetched by the raw id from the URL.
  const orders = await hubOrders(ctx);
  const order = wanted ? orders.find((o) => o.numericId === wanted) : orders[0];
  const back = ctx.url(`/orders${order ? `?order=${order.numericId}` : ""}`);

  const missing = (msg: string) =>
    page(
      "Invoice not found",
      `<main class="sheet" style="text-align:center"><h1 style="text-align:center">We couldn't find that order</h1><p>${esc(msg)}</p><p><a class="btn" href="${esc(ctx.url("/orders"))}">Back to My Orders</a></p></main>`,
    );
  if (!order) return missing("It isn't one of the orders on your account. Check you're signed in with the email you ordered with.");

  const inv = await hubInvoice(ctx, order);
  if (!inv) return missing("We couldn't load this order's details right now. Please try again shortly.");

  const q = `?order=${order.numericId}`;
  return page(
    `${receipt ? "Receipt" : `Invoice ${invoiceNumber(order)}`} · Order ${orderLabel(order)}`,
    invoiceBody(inv, receipt, { invoice: ctx.url(`/invoice${q}`), receipt: ctx.url(`/invoice${q}&view=receipt`), back }),
  );
};
