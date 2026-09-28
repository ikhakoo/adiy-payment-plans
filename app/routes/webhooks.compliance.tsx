import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory privacy webhooks.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // We only store name/email on plans; the merchant can export these from the dashboard.
      console.log(`[compliance] data request for ${shop}`, payload);
      break;
    case "CUSTOMERS_REDACT": {
      const customerId = (payload as { customer?: { id?: number } }).customer?.id;
      if (customerId) {
        await db.paymentPlan.updateMany({
          where: { shop, customerId: `gid://shopify/Customer/${customerId}` },
          data: { customerName: null, customerEmail: null },
        });
      }
      break;
    }
    case "SHOP_REDACT":
      await db.paymentPlan.deleteMany({ where: { shop } });
      await db.settings.deleteMany({ where: { shop } });
      break;
  }
  return new Response();
};
