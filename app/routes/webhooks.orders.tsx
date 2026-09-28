import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncWithOriginOrder } from "../lib/plans.server";

// orders/updated, orders/cancelled — stops a plan when its original order is cancelled.
// (Plans are created from subscription_contracts/create, not here.)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response();

  const orderId = (payload as { admin_graphql_api_id?: string }).admin_graphql_api_id;
  if (!orderId) return new Response();

  try {
    const plan = await db.paymentPlan.findUnique({ where: { orderId } });
    if (plan) await syncWithOriginOrder(admin, plan);
  } catch (e) {
    // 500 makes Shopify redeliver; the handler is idempotent.
    console.error(`[webhooks/orders] ${topic} ${orderId}`, e);
    return new Response("error", { status: 500 });
  }
  return new Response();
};
