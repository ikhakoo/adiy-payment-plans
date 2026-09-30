// Rewards balance: credits (earned) minus cash-outs (requested or sent).
//   pending   = active credits still inside their hold (availableAt in the future)
//   available = active credits past their hold − cash-outs that aren't cancelled
import type { Prisma, Submission } from "@prisma/client";
import db from "../db.server";

const DAY = 24 * 60 * 60 * 1000;
const cents = (d: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(d ?? 0) * 100);

type Client = Prisma.TransactionClient | typeof db;

async function totals(client: Client, shop: string, customerId: string, now: Date) {
  const [ready, pending, nextPending, reserved, sent] = await Promise.all([
    client.rewardCredit.aggregate({
      where: { shop, customerId, cancelledAt: null, availableAt: { lte: now } },
      _sum: { amount: true },
    }),
    client.rewardCredit.aggregate({
      where: { shop, customerId, cancelledAt: null, availableAt: { gt: now } },
      _sum: { amount: true },
    }),
    client.rewardCredit.findFirst({
      where: { shop, customerId, cancelledAt: null, availableAt: { gt: now } },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    }),
    client.cashout.aggregate({ where: { shop, customerId, status: "REQUESTED" }, _sum: { amount: true } }),
    client.cashout.aggregate({ where: { shop, customerId, status: "SENT" }, _sum: { amount: true } }),
  ]);
  const requestedCents = cents(reserved._sum.amount);
  const sentCents = cents(sent._sum.amount);
  return {
    availableCents: cents(ready._sum.amount) - requestedCents - sentCents,
    pendingCents: cents(pending._sum.amount),
    nextAvailableAt: nextPending?.availableAt ?? null,
    requestedCents,
    sentCents,
  };
}

export const balance = (shop: string, customerId: string, now = new Date()) =>
  totals(db, shop, customerId, now);

/** Called on approval: the reward is pending for `holdDays`, then spendable. */
export async function creditSubmission(
  submission: Submission & { rewardType: { name: string } },
  amount: number,
  holdDays: number,
  actor: string,
) {
  return db.rewardCredit.upsert({
    where: { submissionId: submission.id },
    create: {
      shop: submission.shop,
      customerId: submission.customerId,
      customerName: submission.customerName,
      customerEmail: submission.customerEmail,
      source: "SUBMISSION",
      submissionId: submission.id,
      orderId: submission.orderId,
      description: `${submission.rewardType.name} · ${submission.orderName}`,
      amount: amount.toFixed(2),
      availableAt: new Date(Date.now() + holdDays * DAY),
      createdBy: actor,
    },
    update: {},
  });
}

/** Order refunded or cancelled: cancel rewards earned on it that are still in their hold. */
export async function reverseForOrder(shop: string, orderId: string, reason: string) {
  const now = new Date();
  const res = await db.rewardCredit.updateMany({
    where: { shop, orderId, cancelledAt: null, availableAt: { gt: now } },
    data: { cancelledAt: now, cancelReason: reason },
  });
  return res.count;
}

export class CashoutError extends Error {}

/**
 * Reserves `amount` from the available balance. A per-customer advisory lock serialises
 * requests, so two submits at the same moment can't both spend the same balance.
 */
export async function requestCashout(args: {
  shop: string;
  customerId: string;
  customerName: string | null;
  email: string;
  amount: number;
  minCashout: number;
}) {
  const amountCents = Math.round(args.amount * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw new CashoutError("Enter an amount.");
  if (amountCents < Math.round(args.minCashout * 100)) {
    throw new CashoutError(`The minimum cash-out is $${args.minCashout}.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) throw new CashoutError("Enter a valid email address.");

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${args.shop}:${args.customerId}`}))`;
    const t = await totals(tx, args.shop, args.customerId, new Date());
    if (amountCents > t.availableCents) {
      throw new CashoutError(`You can cash out up to $${(t.availableCents / 100).toFixed(2)}.`);
    }
    return tx.cashout.create({
      data: {
        shop: args.shop,
        customerId: args.customerId,
        customerName: args.customerName,
        email: args.email.trim().toLowerCase(),
        amount: (amountCents / 100).toFixed(2),
      },
    });
  });
}

/** Customer-facing history, newest first. */
export async function history(shop: string, customerId: string) {
  const now = new Date();
  const [credits, cashouts] = await Promise.all([
    db.rewardCredit.findMany({ where: { shop, customerId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.cashout.findMany({ where: { shop, customerId }, orderBy: { requestedAt: "desc" }, take: 100 }),
  ]);
  return [
    ...credits.map((c) => ({
      at: c.createdAt,
      label: c.description,
      amount: Number(c.amount),
      status: c.cancelledAt ? "Cancelled" : c.availableAt > now ? `Pending until ${fmtDate(c.availableAt)}` : "Available",
    })),
    ...cashouts.map((c) => ({
      at: c.requestedAt,
      label: `Amazon gift card to ${c.email}`,
      amount: -Number(c.amount),
      status: c.status === "SENT" ? `Sent ${fmtDate(c.sentAt!)}` : c.status === "CANCELLED" ? "Cancelled — returned to balance" : "Requested",
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
}

export const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
