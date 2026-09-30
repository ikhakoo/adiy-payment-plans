// Referrals: a customer shares a link; a friend claims a single-use code tied to their email
// (so only first-time customers can use it); once the friend's order has been delivered for
// `referralWaitDays` and is fully paid, the referrer is credited.
import { randomBytes } from "node:crypto";
import type { Prisma, Referral } from "@prisma/client";
import db from "../db.server";
import { rewardSettings } from "./rewards.server";
import type { AdminGraphql } from "./shopify-ops.server";

const DAY = 24 * 60 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomCode(length: number) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

async function gql<T>(admin: AdminGraphql, query: string, variables: Record<string, unknown> = {}) {
  const res = await admin.graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors || !json.data) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ---------------------------------------------------------------- referrer side

/** The customer's shareable code, created the first time they see the referral card. */
export async function referrerCodeFor(shop: string, customerId: string, name: string | null, email: string | null) {
  const existing = await db.referrerCode.findUnique({ where: { shop_customerId: { shop, customerId } } });
  if (existing) return existing;
  const first = (name ?? "").split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10) || "FRIEND";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.referrerCode.create({
        data: { shop, customerId, customerName: name, customerEmail: email, code: `${first}-${randomCode(4)}` },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // retry on a code collision
    }
  }
  throw new Error("Couldn't create a referral code");
}

// ---------------------------------------------------------------- friend claims

export class ReferralError extends Error {}

const FRIEND_LOOKUP = `#graphql
  query FriendLookup($q: String!) {
    customers(first: 1, query: $q) { nodes { id numberOfOrders defaultEmailAddress { emailAddress } } }
  }`;

const CREATE_FRIEND = `#graphql
  mutation CreateFriend($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }`;

const CREATE_DISCOUNT = `#graphql
  mutation CreateReferralDiscount($d: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $d) {
      codeDiscountNode { id }
      userErrors { field message code }
    }
  }`;

/**
 * A friend enters their email on a referral link. Returns their single-use code (existing
 * unexpired one if they already claimed). Only first-time customers get one.
 */
export async function claimReferral(admin: AdminGraphql, shop: string, referrerCode: string, rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ReferralError("Enter a valid email address.");

  const referrer = await db.referrerCode.findFirst({ where: { shop, code: referrerCode.toUpperCase() } });
  if (!referrer) throw new ReferralError("This referral link isn't valid.");
  if (referrer.customerEmail?.toLowerCase() === email) throw new ReferralError("You can't use your own referral link.");

  const now = new Date();
  const open = await db.referral.findFirst({
    where: { shop, friendEmail: email, status: "ISSUED", expiresAt: { gt: now } },
  });
  if (open) return open;

  // Abuse guard: a referrer can hand out at most 25 codes a day.
  const today = await db.referral.count({
    where: { referrerCodeId: referrer.id, createdAt: { gt: new Date(now.getTime() - DAY) } },
  });
  if (today >= 25) throw new ReferralError("This referral link has been used a lot today — please try again tomorrow.");

  const found = await gql<{ customers: { nodes: { id: string; numberOfOrders: string }[] } }>(admin, FRIEND_LOOKUP, {
    q: `email:${JSON.stringify(email)}`,
  });
  let friend = found.customers.nodes[0];
  if (friend && Number(friend.numberOfOrders) > 0) {
    throw new ReferralError("This offer is for first-time A-DIY customers, so it can't be used with this email.");
  }
  if (!friend) {
    const created = await gql<{
      customerCreate: { customer: { id: string } | null; userErrors: { message: string }[] };
    }>(admin, CREATE_FRIEND, { input: { email, tags: ["referral-friend"] } });
    if (!created.customerCreate.customer) {
      throw new Error(`customerCreate: ${created.customerCreate.userErrors.map((e) => e.message).join("; ")}`);
    }
    friend = { id: created.customerCreate.customer.id, numberOfOrders: "0" };
  }

  const settings = await rewardSettings(shop);
  const expiresAt = new Date(now.getTime() + settings.referralCodeDays * DAY);
  const discountCode = `REF-${randomCode(8)}`;
  const firstName = (referrer.customerName ?? "a friend").split(" ")[0];
  const amount = Number(settings.referralFriendAmount);
  const discount = await gql<{
    discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: { message: string }[] };
  }>(admin, CREATE_DISCOUNT, {
    d: {
      title: `Referral from ${firstName}: $${amount} off`,
      code: discountCode,
      startsAt: now.toISOString(),
      endsAt: expiresAt.toISOString(),
      usageLimit: 1,
      appliesOncePerCustomer: true,
      // Only this (order-less) customer can use it.
      context: { customers: { add: [friend.id] } },
      // On payment plans checkout's subtotal is only the first payment, so a $ minimum would
      // block plans. With a deck-kit collection set, eligibility comes from the products instead.
      ...(settings.referralCollectionId
        ? {}
        : { minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: Number(settings.referralMinOrder).toFixed(2) } } }),
      customerGets: {
        value: { discountAmount: { amount: amount.toFixed(2), appliesOnEachItem: false } },
        items: settings.referralCollectionId
          ? { collections: { add: [settings.referralCollectionId] } }
          : { all: true },
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: true, // works with Pay in 4/6/8 (comes off the first payment)
      },
      recurringCycleLimit: 1,
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    },
  });
  const node = discount.discountCodeBasicCreate.codeDiscountNode;
  if (!node) throw new Error(`discountCodeBasicCreate: ${discount.discountCodeBasicCreate.userErrors.map((e) => e.message).join("; ")}`);

  return db.referral.create({
    data: {
      shop,
      referrerCodeId: referrer.id,
      referrerCustomerId: referrer.customerId,
      friendEmail: email,
      friendCustomerId: friend.id,
      discountCode,
      discountId: node.id,
      expiresAt,
    },
  });
}

// ---------------------------------------------------------------- orders

/** orders/create: an order that used a referral code moves the referral to ORDERED. */
export async function recordReferralOrder(
  shop: string,
  order: { admin_graphql_api_id?: string; name?: string; discount_codes?: { code: string }[] },
) {
  const codes = (order.discount_codes ?? []).map((d) => d.code.toUpperCase()).filter((c) => c.startsWith("REF-"));
  if (!codes.length || !order.admin_graphql_api_id) return;
  await db.referral.updateMany({
    where: { shop, discountCode: { in: codes }, status: "ISSUED" },
    data: { status: "ORDERED", orderId: order.admin_graphql_api_id, orderName: order.name ?? null, orderedAt: new Date() },
  });
}

const REFERRAL_ORDER = `#graphql
  query ReferralOrder($id: ID!) {
    order(id: $id) {
      id name cancelledAt displayFinancialStatus tags
      customer { id numberOfOrders }
      shippingAddress { address1 zip phone }
      phone
      fulfillments(first: 5) { displayStatus deliveredAt createdAt }
    }
  }`;

const REFERRER_ADDRESSES = `#graphql
  query ReferrerAddresses($id: ID!) {
    customer(id: $id) {
      defaultPhoneNumber { phoneNumber }
      defaultAddress { address1 zip phone }
      orders(first: 20, reverse: true) { nodes { shippingAddress { address1 zip phone } } }
    }
  }`;

type Addr = { address1: string | null; zip: string | null; phone: string | null } | null;
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);

async function selfReferralReason(admin: AdminGraphql, referral: Referral, friendAddr: Addr, friendPhone: string | null) {
  const data = await gql<{
    customer: {
      defaultPhoneNumber: { phoneNumber: string } | null;
      defaultAddress: Addr;
      orders: { nodes: { shippingAddress: Addr }[] };
    } | null;
  }>(admin, REFERRER_ADDRESSES, { id: referral.referrerCustomerId });
  if (!data.customer) return null;
  const theirs = [data.customer.defaultAddress, ...data.customer.orders.nodes.map((o) => o.shippingAddress)].filter(Boolean);
  const phones = [data.customer.defaultPhoneNumber?.phoneNumber, ...theirs.map((a) => a!.phone)].map(digits).filter((p) => p.length >= 7);
  if (friendAddr?.address1 && theirs.some((a) => norm(a!.address1) === norm(friendAddr.address1) && norm(a!.zip) === norm(friendAddr.zip))) {
    return "Friend's shipping address matches the referrer's";
  }
  const friendDigits = [friendPhone, friendAddr?.phone].map(digits).filter((p) => p.length >= 7);
  if (friendDigits.some((p) => phones.includes(p))) return "Friend's phone matches the referrer's";
  return null;
}

async function credit(referral: Referral, amount: number, actor: string) {
  const referrer = await db.referrerCode.findUniqueOrThrow({ where: { id: referral.referrerCodeId } });
  return db.rewardCredit.create({
    data: {
      shop: referral.shop,
      customerId: referral.referrerCustomerId,
      customerName: referrer.customerName,
      customerEmail: referrer.customerEmail,
      source: "REFERRAL",
      orderId: referral.orderId,
      description: `Referral · ${referral.friendEmail.replace(/^(.).*(@.*)$/, "$1***$2")} ordered ${referral.orderName ?? ""}`.trim(),
      amount: amount.toFixed(2),
      availableAt: new Date(), // the delivery + wait period already acted as the hold
      createdBy: actor,
    },
  });
}

/** Staff approve a flagged referral. */
export async function approveReferral(referral: Referral, actor: string) {
  const settings = await rewardSettings(referral.shop);
  const c = await credit(referral, Number(settings.referralReward), actor);
  return db.referral.update({
    where: { id: referral.id },
    data: { status: "QUALIFIED", creditId: c.id, handledBy: actor },
  });
}

/**
 * Hourly: expire unused codes, drop referrals whose order was cancelled/refunded, and credit
 * the referrer once the friend's order is delivered + `referralWaitDays` and fully paid.
 */
export async function runReferralCycle(admin: AdminGraphql, shop: string, now = new Date()) {
  const summary = { expired: 0, rejected: 0, qualified: 0, flagged: 0 };
  summary.expired = (
    await db.referral.updateMany({ where: { shop, status: "ISSUED", expiresAt: { lte: now } }, data: { status: "EXPIRED" } })
  ).count;

  const settings = await rewardSettings(shop);
  const ordered = await db.referral.findMany({ where: { shop, status: "ORDERED" }, take: 200 });
  for (const r of ordered) {
    if (!r.orderId) continue;
    const { order } = await gql<{
      order: {
        cancelledAt: string | null;
        displayFinancialStatus: string | null;
        tags: string[];
        customer: { id: string; numberOfOrders: string } | null;
        shippingAddress: Addr;
        phone: string | null;
        fulfillments: { displayStatus: string | null; deliveredAt: string | null; createdAt: string }[];
      } | null;
    }>(admin, REFERRAL_ORDER, { id: r.orderId });
    if (!order) continue;

    const update = (data: Prisma.ReferralUpdateInput) => db.referral.update({ where: { id: r.id }, data });
    if (order.cancelledAt || ["REFUNDED", "VOIDED"].includes(order.displayFinancialStatus ?? "")) {
      await update({ status: "REJECTED", rejectReason: order.cancelledAt ? "Order cancelled" : "Order refunded" });
      summary.rejected++;
      continue;
    }

    const delivered = order.fulfillments.find((f) => f.displayStatus === "DELIVERED")?.deliveredAt;
    const fulfilled = order.fulfillments[0]?.createdAt;
    const deliveredAt = delivered
      ? new Date(delivered)
      : fulfilled
        ? new Date(new Date(fulfilled).getTime() + settings.eligibleDays * DAY) // LTL often never reports delivery
        : null;
    if (!deliveredAt) continue;
    const qualifiesAt = new Date(deliveredAt.getTime() + settings.referralWaitDays * DAY);
    if (!r.qualifiesAt || r.qualifiesAt.getTime() !== qualifiesAt.getTime()) await update({ qualifiesAt });
    if (qualifiesAt > now) continue;

    // Payment plans: the whole plan has to be paid off, not just the first payment.
    if (order.tags.includes("payment-plan")) {
      const plan = await db.paymentPlan.findUnique({ where: { orderId: r.orderId } });
      if (plan && plan.status !== "COMPLETED") continue;
    } else if (order.displayFinancialStatus !== "PAID") {
      continue;
    }

    const flag =
      (order.customer && Number(order.customer.numberOfOrders) > 1 ? "Friend had ordered before" : null) ??
      (await selfReferralReason(admin, r, order.shippingAddress, order.phone));
    if (flag) {
      await update({ status: "FLAGGED", flagReason: flag });
      summary.flagged++;
      continue;
    }
    const c = await credit(r, Number(settings.referralReward), "system");
    await update({ status: "QUALIFIED", creditId: c.id });
    summary.qualified++;
  }
  return summary;
}
