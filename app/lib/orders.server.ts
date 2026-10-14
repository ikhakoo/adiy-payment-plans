// The signed-in customer's orders for the hub (My Orders, Track, Resources, Overview). Always read
// through customer.orders so a customer can only ever see their own orders, whatever ?order= says.
import type { Installment, PaymentPlan } from "@prisma/client";
import db from "../db.server";
import { esc } from "./portal.server";
import type { HubContext } from "./hub.server";

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

/** "?order=123" to keep the selected order when linking between hub sections. */
export const orderQuery = (o: HubOrder | null) => (o ? `?order=${o.numericId}` : "");

/**
 * Order switcher for pages scoped to one order: hidden for a single order, otherwise a small
 * select that reloads `path` with ?order=. Works without JS via the Go button.
 */
export function orderSwitcher(ctx: HubContext, path: string, orders: HubOrder[], selected: HubOrder | null) {
  if (orders.length < 2 || !selected) return "";
  const options = orders
    .map((o) => {
      const line = mainLine(o);
      const label = `${o.name}${line ? ` · ${line.title}` : ""}`;
      return `<option value="${esc(o.numericId)}"${o.id === selected.id ? " selected" : ""}>${esc(label)}</option>`;
    })
    .join("");
  return `<form class="order-switch" method="get" action="${esc(ctx.url(path))}">
      <label class="label" for="hub-order">Order</label>
      <select id="hub-order" name="order" onchange="this.form.submit()">${options}</select>
      <noscript><button class="btn light">Go</button></noscript>
    </form>`;
}

export const fmtDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const fmtDayTime = (iso: string | Date) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** One-line address: "742 Evergreen Terrace, Maplewood, NJ 07040". */
export const addressLine = (a: HubAddress | null) =>
  a ? [a.address1, a.address2, a.city, [a.provinceCode, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
