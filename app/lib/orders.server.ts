// The signed-in customer's orders for the hub (My Orders, Track, Resources, Overview). Always read
// through customer.orders so a customer can only ever see their own orders, whatever ?order= says.
import type { Installment, PaymentPlan } from "@prisma/client";
import db from "../db.server";
import { esc } from "./portal.server";
import { icon, type HubContext } from "./hub.server";

const HUB_ORDERS = `#graphql
  query HubOrders($id: ID!) {
    customer(id: $id) {
      orders(first: 25, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          tags
          statusPageUrl
          note
          customAttributes { key value }
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          totalReceivedSet { shopMoney { amount } }
          totalOutstandingSet { shopMoney { amount } }
          transactions(first: 10) {
            kind
            status
            gateway
            paymentDetails { ... on CardPaymentDetails { company number } }
          }
          shippingAddress { name address1 address2 city provinceCode zip countryCodeV2 phone }
          billingAddress { name address1 address2 city provinceCode zip countryCodeV2 phone }
          lineItems(first: 10) {
            nodes {
              title
              variantTitle
              quantity
              image { url(transform: { maxWidth: 400 }) }
              product { id }
              variant { id }
            }
          }
          fulfillments(first: 10) {
            id
            status
            displayStatus
            createdAt
            inTransitAt
            deliveredAt
            estimatedDeliveryAt
            trackingInfo { company number url }
            events(first: 25, sortKey: HAPPENED_AT) { nodes { status happenedAt message } }
          }
        }
      }
    }
  }`;

export interface HubAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  zip: string | null;
  countryCodeV2: string | null;
  phone: string | null;
}

export interface HubFulfillment {
  id: string;
  status: string;
  displayStatus: string | null;
  createdAt: string;
  inTransitAt: string | null;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  trackingInfo: { company: string | null; number: string | null; url: string | null }[];
  events: { nodes: { status: string; happenedAt: string; message: string | null }[] };
}

export interface HubOrder {
  id: string; // gid://shopify/Order/…
  numericId: string; // what ?order= carries
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  tags: string[];
  statusPageUrl: string;
  note: string | null;
  customAttributes: { key: string; value: string | null }[];
  total: number;
  received: number;
  outstanding: number;
  currency: string;
  /** e.g. "Visa ending in 4242", from the first successful card sale/authorization. */
  card: string | null;
  shippingAddress: HubAddress | null;
  /** Billing address entered at checkout (optional so older mocks/callers without it still type-check). */
  billingAddress?: HubAddress | null;
  lineItems: {
    title: string;
    variantTitle: string | null;
    quantity: number;
    image: string | null;
    productId: string | null;
    variantId: string | null;
  }[];
  fulfillments: HubFulfillment[];
  /** Pay in 4/6/8 plan for this order, if any (from our database). */
  plan: (PaymentPlan & { installments: Installment[] }) | null;
}

type RawOrder = Omit<
  HubOrder,
  "numericId" | "total" | "received" | "outstanding" | "currency" | "card" | "lineItems" | "plan"
> & {
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalReceivedSet: { shopMoney: { amount: string } };
  totalOutstandingSet: { shopMoney: { amount: string } };
  transactions: { kind: string; status: string; gateway: string | null; paymentDetails: { company?: string; number?: string } | null }[];
  lineItems: {
    nodes: {
      title: string;
      variantTitle: string | null;
      quantity: number;
      image: { url: string } | null;
      product: { id: string } | null;
      variant: { id: string } | null;
    }[];
  };
};

const cache = new WeakMap<HubContext, Promise<HubOrder[]>>();

/**
 * The customer's real orders, newest first: no payment-plan installment orders (each monthly
 * billing creates one) and no cancelled orders. Fetched once per request.
 */
export function hubOrders(ctx: HubContext) {
  let pending = cache.get(ctx);
  if (!pending) {
    pending = loadOrders(ctx);
    cache.set(ctx, pending);
  }
  return pending;
}

async function loadOrders(ctx: HubContext): Promise<HubOrder[]> {
  const res = await ctx.admin.graphql(HUB_ORDERS, { variables: { id: ctx.customerId } });
  const json = (await res.json()) as { data?: { customer: { orders: { nodes: RawOrder[] } } | null } };
  const nodes = (json.data?.customer?.orders.nodes ?? []).filter(
    (o) => !o.cancelledAt && !o.tags.includes("payment-plan-installment"),
  );
  const plans = await db.paymentPlan.findMany({
    where: { shop: ctx.shop, orderId: { in: nodes.map((o) => o.id) } },
    include: { installments: { orderBy: { seq: "asc" } } },
  });
  return nodes.map((o) => {
    const cardTx = o.transactions.find(
      (t) => t.status === "SUCCESS" && (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.paymentDetails?.number,
    );
    const last4 = cardTx?.paymentDetails?.number?.replace(/\D/g, "").slice(-4);
    return {
      ...o,
      numericId: o.id.split("/").pop()!,
      total: Number(o.currentTotalPriceSet.shopMoney.amount),
      received: Number(o.totalReceivedSet.shopMoney.amount),
      outstanding: Number(o.totalOutstandingSet.shopMoney.amount),
      currency: o.currentTotalPriceSet.shopMoney.currencyCode,
      card: cardTx && last4 ? `${cardTx.paymentDetails?.company ?? "Card"} ending in ${last4}` : null,
      lineItems: o.lineItems.nodes.map((l) => ({
        title: l.title,
        variantTitle: l.variantTitle,
        quantity: l.quantity,
        image: l.image?.url ?? null,
        productId: l.product?.id ?? null,
        variantId: l.variant?.id ?? null,
      })),
      plan: plans.find((p) => p.orderId === o.id) ?? null,
    };
  });
}

/** The order the page is about: ?order=<numeric id> if it's one of theirs, else the newest. */
export async function selectedOrder(ctx: HubContext, request: Request) {
  const orders = await hubOrders(ctx);
  const wanted = new URL(request.url).searchParams.get("order")?.replace(/\D/g, "");
  const order = orders.find((o) => o.numericId === wanted) ?? orders[0] ?? null;
  return { orders, order };
}

/** Main product line of an order (the deck kit), for headers like "Wood Deck Kit · 10 × 12 ft". */
export const mainLine = (o: HubOrder) => o.lineItems[0] ?? null;

/** Delivery instructions left at checkout: a note attribute that mentions delivery, else the order note. */
export function deliveryNote(o: HubOrder) {
  const attr = o.customAttributes.find((a) => /deliver|instruction|gate|drop/i.test(a.key) && a.value?.trim());
  return attr?.value?.trim() || o.note?.trim() || "";
}

/** "?order=123" to keep the selected order when linking between hub sections. */
export const orderQuery = (o: HubOrder | null) => (o ? `?order=${o.numericId}` : "");

/**
 * Order switcher for pages scoped to one order: hidden for a single order, otherwise a styled
 * select that reloads `path` with ?order=. Works without JS (change submits, <noscript> Go button);
 * public/hub.js upgrades it to an app-styled, keyboard-accessible listbox using the data-* labels.
 */
export function orderSwitcher(ctx: HubContext, path: string, orders: HubOrder[], selected: HubOrder | null) {
  if (orders.length < 2 || !selected) return "";
  const options = orders
    .map((o) => {
      const line = mainLine(o);
      const label = `${o.name}${line ? ` · ${line.title}` : ""}`;
      return `<option value="${esc(o.numericId)}" data-title="${esc(`Order ${o.name}`)}" data-sub="${esc(line?.title ?? "")}" data-meta="${esc(fmtDay(o.createdAt))}"${o.id === selected.id ? " selected" : ""}>${esc(label)}</option>`;
    })
    .join("");
  return `<form class="order-switch sw" method="get" action="${esc(ctx.url(path))}" data-sw>
      <label class="label sw-label" id="hub-order-label" for="hub-order">Viewing order</label>
      <div class="sw-field">
        <select id="hub-order" class="sw-select" name="order" onchange="this.form.submit()">${options}</select>
        <span class="sw-chev">${icon(HUB_ICONS.chevronDown)}</span>
      </div>
      <noscript><button class="btn light">Go</button></noscript>
    </form>`;
}

/** Lucide-style stroke paths for the hub pages' icons (use with icon() from hub.server). */
export const HUB_ICONS = {
  box: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  fileCheck: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  headset: '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  tools: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
  contact: '<path d="M16 2v2M8 2v2M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/><circle cx="12" cy="11" r="3"/><rect x="3" y="4" width="18" height="18" rx="2"/>',
  pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  squareCheck: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
} as const;

/**
 * Total / paid / remaining as the customer should see them. Plan orders: the order total is the
 * receipt total, and only the plan's outstanding balance is still to be charged.
 */
export function paymentTotals(o: HubOrder) {
  const total = o.total;
  const remaining = Math.max(0, o.plan ? Number(o.plan.outstanding) : o.outstanding);
  const paid = o.plan ? Math.max(0, total - remaining) : o.received;
  return { total, paid, remaining };
}

/** "$1,250.50" in the order's currency, always with cents (receipts and invoices). */
export const cents = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);

// ---------------------------------------------------------------- invoice details

const HUB_INVOICE = `#graphql
  query HubInvoice($id: ID!) {
    shop { name contactEmail }
    order(id: $id) {
      id
      name
      createdAt
      processedAt
      taxesIncluded
      discountCodes
      customer { id }
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      currentTotalDiscountsSet { shopMoney { amount } }
      currentShippingPriceSet { shopMoney { amount } }
      currentTotalTaxSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      currentTaxLines { title ratePercentage priceSet { shopMoney { amount } } }
      shippingLine { title }
      billingAddress { name company address1 address2 city provinceCode zip countryCodeV2 phone }
      shippingAddress { name company address1 address2 city provinceCode zip countryCodeV2 phone }
      lineItems(first: 50) {
        nodes {
          title
          variantTitle
          sku
          currentQuantity
          originalUnitPriceSet { shopMoney { amount } }
        }
      }
      transactions(first: 50) {
        kind
        status
        gateway
        formattedGateway
        processedAt
        createdAt
        amountSet { shopMoney { amount } }
        paymentDetails { ... on CardPaymentDetails { company number } }
      }
    }
  }`;

type Money = { shopMoney: { amount: string } };
interface RawInvoice {
  shop: { name: string; contactEmail: string | null };
  order: {
    id: string;
    name: string;
    createdAt: string;
    processedAt: string;
    taxesIncluded: boolean;
    discountCodes: string[];
    customer: { id: string } | null;
    currentSubtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    currentTotalDiscountsSet: Money;
    currentShippingPriceSet: Money;
    currentTotalTaxSet: Money;
    currentTotalPriceSet: Money;
    totalRefundedSet: Money;
    currentTaxLines: { title: string; ratePercentage: number | null; priceSet: Money }[];
    shippingLine: { title: string } | null;
    billingAddress: (HubAddress & { company: string | null }) | null;
    shippingAddress: (HubAddress & { company: string | null }) | null;
    lineItems: {
      nodes: { title: string; variantTitle: string | null; sku: string | null; currentQuantity: number; originalUnitPriceSet: Money }[];
    };
    transactions: {
      kind: string;
      status: string;
      gateway: string | null;
      formattedGateway: string | null;
      processedAt: string | null;
      createdAt: string;
      amountSet: Money;
      paymentDetails: { company?: string; number?: string } | null;
    }[];
  } | null;
}

export interface HubInvoice {
  shopName: string;
  shopEmail: string | null;
  order: HubOrder;
  currency: string;
  taxesIncluded: boolean;
  discountCodes: string[];
  lines: { title: string; variantTitle: string | null; sku: string | null; quantity: number; unit: number; total: number }[];
  itemsTotal: number;
  discounts: number;
  shipping: number;
  shippingTitle: string | null;
  tax: number;
  taxLines: { title: string; rate: number | null; amount: number }[];
  total: number;
  refunded: number;
  paid: number;
  remaining: number;
  billingAddress: (HubAddress & { company: string | null }) | null;
  shippingAddress: (HubAddress & { company: string | null }) | null;
  payments: { date: string; method: string; kind: "Payment" | "Refund"; amount: number }[];
}

/**
 * Invoice / receipt details for one of the customer's orders. `order` must come from hubOrders(ctx)
 * (the customer's own list); it is never looked up from a raw id, and the result is double-checked
 * against the customer before it's returned.
 */
export async function hubInvoice(ctx: HubContext, order: HubOrder): Promise<HubInvoice | null> {
  const res = await ctx.admin.graphql(HUB_INVOICE, { variables: { id: order.id } });
  const json = (await res.json()) as { data?: RawInvoice };
  const o = json.data?.order;
  if (!o || o.customer?.id !== ctx.customerId) return null;
  const n = (m: Money | null | undefined) => Number(m?.shopMoney.amount ?? 0);
  const lines = o.lineItems.nodes
    .filter((l) => l.currentQuantity > 0)
    .map((l) => ({
      title: l.title,
      variantTitle: l.variantTitle,
      sku: l.sku,
      quantity: l.currentQuantity,
      unit: n(l.originalUnitPriceSet),
      total: n(l.originalUnitPriceSet) * l.currentQuantity,
    }));
  const { paid, remaining } = paymentTotals(order);
  const payments = o.transactions
    .filter((t) => t.status === "SUCCESS" && ["SALE", "CAPTURE", "REFUND"].includes(t.kind))
    .map((t) => {
      const last4 = t.paymentDetails?.number?.replace(/\D/g, "").slice(-4);
      const method = last4 ? `${t.paymentDetails?.company ?? "Card"} ending in ${last4}` : t.formattedGateway || t.gateway || "Payment";
      return {
        date: t.processedAt ?? t.createdAt,
        method,
        kind: t.kind === "REFUND" ? ("Refund" as const) : ("Payment" as const),
        amount: n(t.amountSet),
      };
    })
    // Plan payments after checkout are charged on their own installment orders, so they're not in
    // this order's transactions: list them from the plan (seq 1 is the checkout payment above).
    .concat(
      (order.plan?.installments ?? [])
        .filter((i) => i.status === "PAID" && i.seq > 1)
        .map((i) => ({
          date: new Date(i.paidAt ?? i.dueDate).toISOString(),
          method: `Plan payment ${i.seq} of ${order.plan!.installmentsCount}${i.chargeOrderName ? ` · ${i.chargeOrderName}` : ""}`,
          kind: "Payment" as const,
          amount: Number(i.amount),
        })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    shopName: json.data?.shop.name ?? "A-DIY",
    shopEmail: json.data?.shop.contactEmail ?? null,
    order,
    currency: o.currentSubtotalPriceSet.shopMoney.currencyCode,
    taxesIncluded: o.taxesIncluded,
    discountCodes: o.discountCodes,
    lines,
    itemsTotal: lines.reduce((sum, l) => sum + l.total, 0),
    discounts: n(o.currentTotalDiscountsSet),
    shipping: n(o.currentShippingPriceSet),
    shippingTitle: o.shippingLine?.title ?? null,
    tax: n(o.currentTotalTaxSet),
    taxLines: o.currentTaxLines.map((t) => ({ title: t.title, rate: t.ratePercentage, amount: n(t.priceSet) })),
    total: n(o.currentTotalPriceSet),
    refunded: n(o.totalRefundedSet),
    paid,
    remaining,
    billingAddress: o.billingAddress,
    shippingAddress: o.shippingAddress,
    payments,
  };
}

export const fmtDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const fmtDayTime = (iso: string | Date) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** One-line address: "742 Evergreen Terrace, Maplewood, NJ 07040". */
export const addressLine = (a: HubAddress | null) =>
  a ? [a.address1, a.address2, a.city, [a.provinceCode, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
