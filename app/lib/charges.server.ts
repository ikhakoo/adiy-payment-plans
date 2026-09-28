import type { Installment, PaymentPlan } from "@prisma/client";
import db from "../db.server";
import { audit, contractReady, refreshPlan } from "./plans.server";
import { fromCents, nextRetryDate, toCents } from "./schedule";
import {
  billCycle,
  editContractLine,
  fetchBillingOutcome,
  fetchContract,
  ShopifyUserError,
  tagOrder,
  type AdminGraphql,
} from "./shopify-ops.server";

export interface CycleSummary {
  charged: number;
  succeeded: number;
  failed: number;
  pending: number;
  skipped: number;
}

/**
 * One pass of the charge engine for a shop:
 *  1. settle billings already sent to Shopify (PROCESSING → PAID/FAILED),
 *  2. bill installments that are due (or due for a retry).
 * Runs hourly; every step is idempotent.
 */
export async function runChargeCycle(admin: AdminGraphql, shop: string, now = new Date()) {
  const summary: CycleSummary = { charged: 0, succeeded: 0, failed: 0, pending: 0, skipped: 0 };
  const retryDays = (await db.settings.findUnique({ where: { shop } }))?.retryDays ?? [3, 7];

  const processing = await db.installment.findMany({
    where: { status: "PROCESSING", plan: { shop } },
    include: { plan: true },
  });
  for (const inst of processing) {
    summary[await settleInstallment(admin, inst, inst.plan, retryDays, now)]++;
  }

  const due = await db.installment.findMany({
    where: {
      plan: { shop, status: { in: ["ACTIVE", "PAST_DUE"] } },
      OR: [
        { status: "SCHEDULED", dueDate: { lte: now } },
        { status: "FAILED", nextAttemptAt: { lte: now } },
      ],
    },
    include: { plan: true },
    orderBy: [{ dueDate: "asc" }, { seq: "asc" }],
  });

  const billedPlans = new Set<string>();
  for (const inst of due) {
    // One billing per plan per pass, oldest installment first.
    if (billedPlans.has(inst.planId)) continue;
    billedPlans.add(inst.planId);
    const r = await startCharge(admin, inst, inst.plan, retryDays, now);
    summary[r === "started" ? "charged" : "skipped"]++;
  }
  return summary;
}

async function startCharge(
  admin: AdminGraphql,
  inst: Installment,
  plan: PaymentPlan,
  retryDays: number[],
  now: Date,
): Promise<"started" | "skipped"> {
  if (!plan.contractId || !(await contractReady(admin, plan))) {
    await audit(plan.id, "charge_skipped", `Installment ${inst.seq}: contract isn't set up for payment-only billing yet`);
    return "skipped";
  }

  // The last installment takes whatever is left so rounding never strands a few cents.
  const paid = await db.installment.findMany({ where: { planId: plan.id, status: "PAID" } });
  const outstandingCents =
    toCents(plan.total.toString()) - paid.reduce((s, i) => s + toCents(i.amount.toString()), 0);
  if (outstandingCents <= 0) {
    await refreshPlan(admin, plan.id);
    return "skipped";
  }
  const isLast = inst.seq === plan.installmentsCount;
  const amountCents = isLast ? outstandingCents : Math.min(toCents(inst.amount.toString()), outstandingCents);

  // Claim the installment so an overlapping run can't bill it twice.
  const attempt = inst.attempts + 1;
  const key = `${plan.id}:${inst.seq}:${attempt}`;
  const claimed = await db.installment.updateMany({
    where: { id: inst.id, status: inst.status, attempts: inst.attempts },
    data: {
      status: "PROCESSING",
      attempts: attempt,
      idempotencyKey: key,
      nextAttemptAt: null,
      billingAttemptId: null,
      amount: fromCents(amountCents),
    },
  });
  if (claimed.count === 0) return "skipped";

  try {
    // The contract bills whatever its line costs, so set it to this installment first.
    const contract = await fetchContract(admin, plan.contractId);
    const line = contract?.lines.nodes[0];
    if (!line) throw new Error("Contract has no line to bill");
    if (toCents(line.currentPrice.amount) !== amountCents) {
      await editContractLine(admin, {
        contractId: plan.contractId,
        lineId: line.id,
        price: fromCents(amountCents),
      });
    }
    const billingAttemptId = await billCycle(admin, {
      contractId: plan.contractId,
      seq: inst.seq,
      key,
    });
    await db.installment.update({ where: { id: inst.id }, data: { billingAttemptId } });
    await audit(plan.id, "charge_started", `Installment ${inst.seq}: billing ${fromCents(amountCents)} ${plan.currency} + tax`, {
      attempt,
      billingAttemptId,
    });
  } catch (e) {
    if (e instanceof ShopifyUserError) {
      // Shopify rejected the request outright (e.g. payment method revoked).
      await markFailed(inst.id, plan, inst.seq, attempt, e.message, now, retryDays);
    } else {
      // Network/API failure: the billing may or may not have been created. Stay PROCESSING;
      // the next pass resends with the SAME key, which Shopify deduplicates.
      await db.installment.update({ where: { id: inst.id }, data: { lastError: String(e) } });
      await audit(plan.id, "charge_error", `Installment ${inst.seq}: ${String(e)}`);
    }
  }
  return "started";
}

/** Resolves a PROCESSING installment. Also called from the billing-attempt webhooks. */
export async function settleInstallment(
  admin: AdminGraphql,
  inst: Installment,
  plan: PaymentPlan,
  retryDays: number[],
  now = new Date(),
): Promise<"succeeded" | "failed" | "pending"> {
  if (inst.status !== "PROCESSING") return "pending";

  if (!inst.billingAttemptId) {
    // The earlier request errored before we got an id: resend with the same key.
    if (!plan.contractId || !inst.idempotencyKey) return "pending";
    try {
      const billingAttemptId = await billCycle(admin, {
        contractId: plan.contractId,
        seq: inst.seq,
        key: inst.idempotencyKey,
      });
      await db.installment.update({ where: { id: inst.id }, data: { billingAttemptId } });
    } catch (e) {
      if (e instanceof ShopifyUserError) {
        await markFailed(inst.id, plan, inst.seq, inst.attempts, e.message, now, retryDays);
        return "failed";
      }
      throw e;
    }
    return "pending";
  }

  const result = await fetchBillingOutcome(admin, inst.billingAttemptId);
  if (result.outcome === "pending") return "pending";

  if (result.outcome === "succeeded") {
    const updated = await db.installment.updateMany({
      where: { id: inst.id, status: "PROCESSING" },
      data: {
        status: "PAID",
        paidAt: now,
        lastError: null,
        chargeOrderId: result.orderId,
        chargeOrderName: result.orderName,
      },
    });
    if (updated.count === 0) return "succeeded"; // the webhook and the cron both got here
    await tagOrder(admin, result.orderId, ["payment-plan-installment", `plan-${plan.orderName.replace("#", "")}`]);
    await audit(plan.id, "charge_succeeded", `Installment ${inst.seq} paid — ${result.orderName} (${result.orderTotal} ${plan.currency} incl. tax)`);
    await refreshPlan(admin, plan.id);
    return "succeeded";
  }

  await markFailed(inst.id, plan, inst.seq, inst.attempts, result.error, now, retryDays);
  return "failed";
}

async function markFailed(
  installmentId: string,
  plan: PaymentPlan,
  seq: number,
  attempts: number,
  message: string,
  now: Date,
  retryDays: number[],
) {
  const retryAt = nextRetryDate(now, attempts, retryDays);
  await db.installment.update({
    where: { id: installmentId },
    data: { status: "FAILED", lastError: message, nextAttemptAt: retryAt },
  });
  await db.paymentPlan.update({
    where: { id: plan.id },
    data: { status: retryAt ? "PAST_DUE" : "DEFAULTED" },
  });
  await audit(
    plan.id,
    "charge_failed",
    `Installment ${seq} failed (attempt ${attempts}): ${message}` +
      (retryAt ? ` — retrying ${retryAt.toISOString().slice(0, 10)}` : " — retries exhausted, plan defaulted"),
  );
}
