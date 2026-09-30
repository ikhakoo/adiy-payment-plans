// Runs against the local Postgres (DATABASE_URL in .env); each test uses its own shop id.
import { afterAll, describe, expect, it } from "vitest";
import db from "../db.server";
import { balance, CashoutError, requestCashout, reverseForOrder } from "./ledger.server";

const shop = `ledger-test-${Date.now()}.myshopify.com`;
const customerId = "gid://shopify/Customer/1";
const DAY = 86_400_000;

async function credit(amount: number, availableInDays: number, orderId = "gid://shopify/Order/1") {
  return db.rewardCredit.create({
    data: {
      shop,
      customerId,
      source: "ADJUSTMENT",
      orderId,
      description: "test",
      amount: amount.toFixed(2),
      availableAt: new Date(Date.now() + availableInDays * DAY),
    },
  });
}

afterAll(async () => {
  await db.cashout.deleteMany({ where: { shop } });
  await db.rewardCredit.deleteMany({ where: { shop } });
  await db.$disconnect();
});

describe("ledger", () => {
  it("separates available from pending", async () => {
    await credit(100, -1); // past its hold
    await credit(50, 7, "gid://shopify/Order/2"); // still on hold
    const b = await balance(shop, customerId);
    expect(b.availableCents).toBe(10000);
    expect(b.pendingCents).toBe(5000);
    expect(b.nextAvailableAt).not.toBeNull();
  });

  it("enforces the minimum and the available balance", async () => {
    const base = { shop, customerId, customerName: null, email: "a@b.co", minCashout: 25 };
    await expect(requestCashout({ ...base, amount: 10 })).rejects.toBeInstanceOf(CashoutError);
    await expect(requestCashout({ ...base, amount: 150 })).rejects.toThrow(/up to \$100/);
  });

  it("lets only one of two simultaneous requests spend the same balance", async () => {
    const base = { shop, customerId, customerName: null, email: "a@b.co", minCashout: 25 };
    const results = await Promise.allSettled([
      requestCashout({ ...base, amount: 60 }),
      requestCashout({ ...base, amount: 60 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await balance(shop, customerId)).availableCents).toBe(4000);
  });

  it("a cancelled cash-out returns to the balance", async () => {
    await db.cashout.updateMany({ where: { shop }, data: { status: "CANCELLED" } });
    expect((await balance(shop, customerId)).availableCents).toBe(10000);
  });

  it("refunding an order cancels only rewards still on hold", async () => {
    expect(await reverseForOrder(shop, "gid://shopify/Order/2", "Order refunded")).toBe(1);
    expect(await reverseForOrder(shop, "gid://shopify/Order/1", "Order refunded")).toBe(0);
    const b = await balance(shop, customerId);
    expect(b.pendingCents).toBe(0);
    expect(b.availableCents).toBe(10000);
  });
});
