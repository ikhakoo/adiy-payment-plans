import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import db from "../db.server";
import { runChargeCycle } from "../lib/charges.server";
import { runReferralCycle } from "../lib/referrals.server";

// POST /jobs/charges — called by the scheduler (Render cron) with
// `Authorization: Bearer $CRON_SECRET`. For every installed shop: one payment-plan charge
// cycle, then one referral cycle (expire codes, credit referrers whose friend qualified).
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const shops = await db.session.findMany({
    where: { isOnline: false },
    select: { shop: true },
    distinct: ["shop"],
  });

  const results: Record<string, unknown> = {};
  for (const { shop } of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      results[shop] = {
        charges: await runChargeCycle(admin, shop),
        referrals: await runReferralCycle(admin, shop),
      };
    } catch (e) {
      console.error(`[jobs/charges] ${shop}`, e);
      results[shop] = { error: String(e) };
    }
  }
  return Response.json(results);
};

export const loader = () => new Response("POST only", { status: 405 });
