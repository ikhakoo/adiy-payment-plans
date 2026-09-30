import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncWithOriginOrder } from "../lib/plans.server";
import { reverseForOrder } from "../lib/ledger.server";

// orders/updated, orders/cancelled — stops a plan when its original order is cancelled, and
// cancels rewards earned on an order that's refunded or cancelled while they're still on hold.
// (Plans are created from subscription_contracts/create, not here.)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response();

  const orderId = (payload as { admin_graphql_api_id?: string }).admin_graphql_api_id;
  if (!orderId) return new Response();

  try {
    const order = payload as { cancelled_at?: string | null; financial_status?: string | null };
    if (order.cancelled_at || ["refunded", "voided"].includes(order.financial_status ?? "")) {
      await reverseForOrder(shop, orderId, order.cancelled_at ? "Order cancelled" : "Order refunded");
    }
    const plan = await db.paymentPlan.findUnique({ where: { orderId } });
    if (plan) await syncWithOriginOrder(admin, plan);
  } catch (e) {
    // 500 makes Shopify redeliver; the handler is idempotent.
    console.error(`[webhooks/orders] ${topic} ${orderId}`, e);
    return new Response("error", { status: 500 });
  }
  return new Response();
};
