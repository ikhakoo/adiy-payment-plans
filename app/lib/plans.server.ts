import { Prisma, type PaymentPlan } from "@prisma/client";
import db from "../db.server";
import { buildSchedule, fromCents, toCents } from "./schedule";
import {
  editContractLine,
  endContract,
  fetchContract,
  fetchPlanOrder,
  holdFulfillment,
  releaseFulfillment,
  tagOrder,
  type AdminGraphql,
  type PlanContract,
} from "./shopify-ops.server";

export async function audit(
  planId: string,
  type: string,
  message?: string,
  data?: Prisma.InputJsonValue,
  actor = "system",
) {
  await db.auditEvent.create({ data: { planId, type, message, data, actor } });
}

async function settingsFor(shop: string) {
  const settings = await db.settings.findUnique({ where: { shop } });
  return {
    planCounts: (settings?.planCounts as Record<string, number> | null) ?? {},
    installmentVariantId: settings?.installmentVariantId ?? null,
  };
}

/** The contract line bought on one of our Pay-in-N plans, if any. */
function planLine(contract: PlanContract, planCounts: Record<string, number>) {
  for (const line of contract.lines.nodes) {
    if (line.sellingPlanId && planCounts[line.sellingPlanId]) {
      return { line, count: planCounts[line.sellingPlanId] };
    }
  }
  return null;
}

/**
 * subscription_contracts/create: record the plan and its schedule, turn the contract into a
 * payment-only contract, and hold the original order. Every step is idempotent, so a
 * redelivered webhook finishes whatever a failed delivery didn't.
 */
export async function ensurePlanFromContract(
  admin: AdminGraphql,
  shop: string,
  contractId: string,
  opts: { source?: "STOREFRONT" | "REP"; repStaffId?: string } = {},
) {
  const contract = await fetchContract(admin, contractId);
  if (!contract?.originOrder) return null;
  const { planCounts, installmentVariantId } = await settingsFor(shop);

  let plan = await db.paymentPlan.findUnique({
    where: { contractId },
    include: { installments: { orderBy: { seq: "asc" } } },
  });

  if (!plan) {
    const match = planLine(contract, planCounts);
    if (!match) return null; // someone else's subscription
    const order = await fetchPlanOrder(admin, contract.originOrder.id);
    if (!order) return null;

    const { line, count } = match;
    const totalCents = toCents(line.pricingPolicy?.basePrice.amount ?? "0") * line.quantity;
    const firstCents = toCents(line.currentPrice.amount) * line.quantity;
    const schedule = buildSchedule({
      checkoutPaidCents: firstCents,
      outstandingCents: totalCents - firstCents,
      count,
      startDate: new Date(order.createdAt),
    });

    try {
      plan = await db.paymentPlan.create({
        data: {
          shop,
          orderId: order.id,
          orderName: order.name,
          contractId,
          customerId: contract.customer?.id,
          customerName: contract.customer?.displayName,
          customerEmail: contract.customer?.defaultEmailAddress?.emailAddress,
          sellingPlanId: line.sellingPlanId,
          source: opts.source ?? "STOREFRONT",
          repStaffId: opts.repStaffId,
          installmentsCount: count,
          currency: contract.currencyCode,
          total: fromCents(totalCents),
          paid: fromCents(firstCents),
          outstanding: fromCents(totalCents - firstCents),
          installments: {
            create: schedule.map((s) => ({
              seq: s.seq,
              dueDate: s.dueDate,
              amount: fromCents(s.amountCents),
              status: s.seq === 1 ? "PAID" : "SCHEDULED",
              paidAt: s.seq === 1 ? new Date(order.createdAt) : null,
              chargeOrderId: s.seq === 1 ? order.id : null,
              chargeOrderName: s.seq === 1 ? order.name : null,
            })),
          },
        },
        include: { installments: { orderBy: { seq: "asc" } } },
      });
    } catch (e) {
      // Two deliveries raced; the other one created it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return db.paymentPlan.findUnique({ where: { contractId } });
      }
      throw e;
    }
    await audit(plan.id, "plan_created", `Pay in ${count}: ${fromCents(totalCents - firstCents)} ${plan.currency} left after checkout`);
  }

  // Swap the deck for the payment-only line (once). Until this runs, a billing would create
  // an order for another deck, so charging waits for it (see charges.server).
  const line = contract.lines.nodes[0];
  if (installmentVariantId && line && line.variantId !== installmentVariantId) {
    const next = plan.installments.find((i) => i.status !== "PAID");
    await editContractLine(admin, {
      contractId,
      lineId: line.id,
      variantId: installmentVariantId,
      price: next ? next.amount.toString() : "0.00",
      draft: { deliveryPrice: "0", note: `Monthly payment for payment-plan order ${plan.orderName}` },
    });
    await audit(plan.id, "contract_prepared", "Contract switched to monthly payment-only billing");
  } else if (!installmentVariantId) {
    await audit(plan.id, "setup_incomplete", "No installment product configured — open the app and finish setup");
  }

  if (!plan.fulfillmentHeld && plan.status === "ACTIVE") {
    const order = await fetchPlanOrder(admin, plan.orderId);
    if (order) {
      await holdFulfillment(admin, order);
      await tagOrder(admin, order.id, ["payment-plan", `pay-in-${plan.installmentsCount}`]);
      await db.paymentPlan.update({ where: { id: plan.id }, data: { fulfillmentHeld: true } });
    }
  }
  return plan;
}

/** Whether the contract is ready to bill (its line is the installment product). */
export async function contractReady(admin: AdminGraphql, plan: PaymentPlan) {
  if (!plan.contractId) return false;
  const [{ installmentVariantId }, contract] = await Promise.all([
    settingsFor(plan.shop),
    fetchContract(admin, plan.contractId),
  ]);
  return Boolean(
    contract && installmentVariantId && contract.lines.nodes[0]?.variantId === installmentVariantId,
  );
}

/**
 * Recomputes paid/outstanding from the installments. When nothing is left, completes the
 * plan: releases the original order's hold, tags it, and ends the contract.
 */
export async function refreshPlan(admin: AdminGraphql, planId: string) {
  const plan = await db.paymentPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { installments: true },
  });
  const paidCents = plan.installments
    .filter((i) => i.status === "PAID")
    .reduce((s, i) => s + toCents(i.amount.toString()), 0);
  const outstandingCents = Math.max(0, toCents(plan.total.toString()) - paidCents);
  const data: Prisma.PaymentPlanUpdateInput = {
    paid: fromCents(paidCents),
    outstanding: fromCents(outstandingCents),
  };

  if (plan.status === "PAST_DUE" && !plan.installments.some((i) => i.status === "FAILED")) {
    data.status = "ACTIVE";
  }

  if (outstandingCents === 0 && plan.status !== "COMPLETED" && plan.status !== "CANCELLED") {
    const order = await fetchPlanOrder(admin, plan.orderId);
    if (order) {
      await releaseFulfillment(admin, order);
      await tagOrder(admin, order.id, ["plan-paid-in-full"]);
    }
    if (plan.contractId) await endContract(admin, plan.contractId, "expire");
    await db.installment.updateMany({
      where: { planId, status: { in: ["SCHEDULED", "FAILED"] } },
      data: { status: "SKIPPED", nextAttemptAt: null },
    });
    Object.assign(data, { status: "COMPLETED", completedAt: new Date(), fulfillmentHeld: false });
    await audit(planId, "plan_completed", "Paid in full — fulfillment released");
  }
  return db.paymentPlan.update({ where: { id: planId }, data });
}

/** orders/updated|cancelled on the original order: stop the plan if the order was cancelled. */
export async function syncWithOriginOrder(admin: AdminGraphql, plan: PaymentPlan) {
  if (plan.status === "CANCELLED" || plan.status === "COMPLETED") return plan;
  const order = await fetchPlanOrder(admin, plan.orderId);
  if (!order?.cancelledAt) return plan;

  if (plan.contractId) await endContract(admin, plan.contractId, "cancel");
  await db.installment.updateMany({
    where: { planId: plan.id, status: { in: ["SCHEDULED", "FAILED"] } },
    data: { status: "SKIPPED", nextAttemptAt: null },
  });
  await audit(plan.id, "plan_cancelled", "Original order was cancelled in Shopify — no further payments");
  return db.paymentPlan.update({ where: { id: plan.id }, data: { status: "CANCELLED" } });
}
