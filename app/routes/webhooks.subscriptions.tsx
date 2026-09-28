import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensurePlanFromContract } from "../lib/plans.server";
import { settleInstallment } from "../lib/charges.server";

// subscription_contracts/create — a customer checked out on a Pay-in-N plan.
// subscription_billing_attempts/success|failure — settle the installment right away instead of
// waiting for the hourly job (which would settle it anyway).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response();
  const body = payload as { admin_graphql_api_id?: string; id?: number };

  try {
    if (topic === "SUBSCRIPTION_CONTRACTS_CREATE") {
      const contractId = body.admin_graphql_api_id ?? `gid://shopify/SubscriptionContract/${body.id}`;
      await ensurePlanFromContract(admin, shop, contractId);
    } else {
      const attemptId = body.admin_graphql_api_id ?? `gid://shopify/SubscriptionBillingAttempt/${body.id}`;
      const inst = await db.installment.findFirst({
        where: { billingAttemptId: attemptId },
        include: { plan: true },
      });
      if (inst) {
        const settings = await db.settings.findUnique({ where: { shop } });
        await settleInstallment(admin, inst, inst.plan, settings?.retryDays ?? [3, 7]);
      }
    }
  } catch (e) {
    console.error(`[webhooks/subscriptions] ${topic}`, e);
    return new Response("error", { status: 500 });
  }
  return new Response();
};
