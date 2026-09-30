// Runs against the local Postgres (DATABASE_URL in .env) with a fake Shopify Admin client.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../db.server";
import { claimReferral, recordReferralOrder, ReferralError, referrerCodeFor, runReferralCycle } from "./referrals.server";

const shop = `referral-test-${Date.now()}.myshopify.com`;
const referrerId = "gid://shopify/Customer/100";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

// ---- fake Shopify
const customersByEmail: Record<string, { id: string; numberOfOrders: string }> = {
  "repeat@example.com": { id: "gid://shopify/Customer/200", numberOfOrders: "3" },
};
const orders: Record<string, unknown> = {};
const calls: { op: string; variables: Record<string, unknown> }[] = [];
let nextId = 500;

const admin = {
  graphql: async (query: string, opts?: { variables?: Record<string, unknown> }) => {
    const variables = opts?.variables ?? {};
    const op = query.match(/(query|mutation)\s+(\w+)/)![2];
    calls.push({ op, variables });
    const data = (() => {
      switch (op) {
        case "FriendLookup": {
          const email = JSON.parse(String(variables.q).replace(/^email:/, ""));
          const c = customersByEmail[email];
          return { customers: { nodes: c ? [c] : [] } };
        }
        case "CreateFriend":
          return { customerCreate: { customer: { id: `gid://shopify/Customer/${nextId++}` }, userErrors: [] } };
        case "CreateReferralDiscount":
          return { discountCodeBasicCreate: { codeDiscountNode: { id: `gid://shopify/DiscountCodeNode/${nextId++}` }, userErrors: [] } };
        case "ReferralOrder":
          return { order: orders[String(variables.id)] ?? null };
        case "ReferrerAddresses":
          return {
            customer: {
              defaultPhoneNumber: { phoneNumber: "+1 (786) 555-0100" },
              defaultAddress: { address1: "1 Deck Way", zip: "33101", phone: null },
              orders: { nodes: [] },
            },
          };
        default:
          throw new Error(`unexpected ${op}`);
      }
    })();
    return new Response(JSON.stringify({ data }));
  },
};

const order = (over: Record<string, unknown>) => ({
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  tags: [],
  customer: { id: "gid://shopify/Customer/x", numberOfOrders: "1" },
  shippingAddress: { address1: "9 Other St", zip: "10001", phone: null },
  phone: null,
  fulfillments: [{ displayStatus: "DELIVERED", deliveredAt: ago(31), createdAt: ago(40) }],
  ...over,
});

let code: string;

beforeAll(async () => {
  const r = await referrerCodeFor(shop, referrerId, "Imran Khakoo", "imran@example.com");
  code = r.code;
});

afterAll(async () => {
  await db.rewardCredit.deleteMany({ where: { shop } });
  await db.referral.deleteMany({ where: { shop } });
  await db.referrerCode.deleteMany({ where: { shop } });
  await db.rewardSettings.deleteMany({ where: { shop } });
  await db.$disconnect();
});

async function referralFor(email: string, orderId: string) {
  const r = await claimReferral(admin, shop, code, email);
  await recordReferralOrder(shop, { admin_graphql_api_id: orderId, name: "#1", discount_codes: [{ code: r.discountCode.toLowerCase() }] });
  return r;
}

describe("claiming", () => {
  it("gives the referrer a readable code", () => {
    expect(code).toMatch(/^IMRAN-[A-Z2-9]{4}$/);
  });

  it("refuses the referrer's own email and existing customers", async () => {
    await expect(claimReferral(admin, shop, code, "Imran@Example.com")).rejects.toBeInstanceOf(ReferralError);
    await expect(claimReferral(admin, shop, code, "repeat@example.com")).rejects.toThrow(/first-time/);
  });

  it("creates the friend and a single-use code only they can use, reusing it on a second claim", async () => {
    const first = await claimReferral(admin, shop, code, "New@Friend.com");
    const again = await claimReferral(admin, shop, code, "new@friend.com");
    expect(again.id).toBe(first.id);
    const discount = calls.find((c) => c.op === "CreateReferralDiscount")!.variables.d as {
      usageLimit: number;
      context: { customers: { add: string[] } };
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: string } };
      customerGets: { appliesOnSubscription: boolean };
    };
    expect(discount.usageLimit).toBe(1);
    expect(discount.context.customers.add).toEqual([first.friendCustomerId]);
    expect(discount.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal).toBe("2000.00");
    expect(discount.customerGets.appliesOnSubscription).toBe(true);
    expect(calls.filter((c) => c.op === "CreateReferralDiscount")).toHaveLength(1);
  });
});

describe("qualifying", () => {
  it("credits the referrer once delivered + 30 days and paid", async () => {
    orders["gid://shopify/Order/1"] = order({});
    const r = await referralFor("good@friend.com", "gid://shopify/Order/1");
    await runReferralCycle(admin, shop);
    const after = await db.referral.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("QUALIFIED");
    const credit = await db.rewardCredit.findUniqueOrThrow({ where: { id: after.creditId! } });
    expect(Number(credit.amount)).toBe(300);
    expect(credit.customerId).toBe(referrerId);
    expect(credit.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("waits while the order is inside the wait period", async () => {
    orders["gid://shopify/Order/2"] = order({ fulfillments: [{ displayStatus: "DELIVERED", deliveredAt: ago(10), createdAt: ago(15) }] });
    const r = await referralFor("early@friend.com", "gid://shopify/Order/2");
    await runReferralCycle(admin, shop);
    const after = await db.referral.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("ORDERED");
    expect(after.qualifiesAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects cancelled orders and flags self-referrals and repeat customers", async () => {
    orders["gid://shopify/Order/3"] = order({ cancelledAt: ago(1) });
    orders["gid://shopify/Order/4"] = order({ shippingAddress: { address1: "1 Deck Way", zip: "33101", phone: null } });
    orders["gid://shopify/Order/5"] = order({ customer: { id: "x", numberOfOrders: "2" } });
    const [cancelled, sameAddress, repeat] = [
      await referralFor("c@friend.com", "gid://shopify/Order/3"),
      await referralFor("a@friend.com", "gid://shopify/Order/4"),
      await referralFor("r@friend.com", "gid://shopify/Order/5"),
    ];
    await runReferralCycle(admin, shop);
    const status = async (id: string) => (await db.referral.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(cancelled.id)).toBe("REJECTED");
    expect(await status(sameAddress.id)).toBe("FLAGGED");
    expect(await status(repeat.id)).toBe("FLAGGED");
  });

  it("waits for a payment plan to be paid off", async () => {
    orders["gid://shopify/Order/6"] = order({ tags: ["payment-plan"], displayFinancialStatus: "PARTIALLY_PAID" });
    await db.paymentPlan.create({
      data: {
        shop,
        orderId: "gid://shopify/Order/6",
        orderName: "#6",
        installmentsCount: 4,
        total: "4000",
        paid: "1000",
        outstanding: "3000",
      },
    });
    const r = await referralFor("plan@friend.com", "gid://shopify/Order/6");
    await runReferralCycle(admin, shop);
    expect((await db.referral.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("ORDERED");
    await db.paymentPlan.update({ where: { orderId: "gid://shopify/Order/6" }, data: { status: "COMPLETED" } });
    await runReferralCycle(admin, shop);
    expect((await db.referral.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("QUALIFIED");
    await db.paymentPlan.deleteMany({ where: { shop } });
  });
});
