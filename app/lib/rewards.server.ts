import type { RewardType, Submission } from "@prisma/client";
import db from "../db.server";
import { ensureFolder } from "./google.server";
import type { AdminGraphql } from "./shopify-ops.server";

// Placeholder until legal signs off; editable in the app's Rewards settings (bumps the version).
export const DEFAULT_AGREEMENT = `By submitting, you confirm that you created this content and own the rights to it, and that anyone shown in it has agreed to be included. You grant A-DIY a perpetual, royalty-free licence to use, edit and publish it (including your first name and city) in marketing on any channel. You're receiving a reward for sharing your honest experience; the reward doesn't depend on what you say about the product, and A-DIY may disclose that you were rewarded.`;

export const DEFAULT_REWARD_TYPES = [
  {
    name: "Full video walkthrough",
    description:
      "You on camera for 2+ minutes with your finished deck: how setup went, the quality, and how you use it.",
    media: "VIDEO" as const,
    minAmount: 200,
    maxAmount: 200,
  },
  {
    name: "Simple video review",
    description: "A short video (30 seconds or more) showing your deck and what you think of it.",
    media: "VIDEO" as const,
    minAmount: 100,
    maxAmount: 100,
  },
  {
    name: "Photo set",
    description: "6 or more clear, well-lit photos of your finished deck from different angles.",
    media: "PHOTO" as const,
    minAmount: 25,
    maxAmount: 50,
  },
];

export const LIMITS = {
  videoBytes: 2 * 1024 ** 3,
  photoBytes: 25 * 1024 ** 2,
  videosPerSubmission: 3,
  photosPerSubmission: 20,
};

export async function rewardSettings(shop: string) {
  const s = await db.rewardSettings.upsert({ where: { shop }, create: { shop }, update: {} });
  return { ...s, agreementText: s.agreementText ?? DEFAULT_AGREEMENT };
}

/** Soft launch: while the portal is off, only listed tester emails can use it. */
export function portalAllowed(
  settings: { portalEnabled: boolean; testerEmails: string[] },
  email: string | null | undefined,
) {
  if (settings.portalEnabled) return true;
  return Boolean(email && settings.testerEmails.includes(email.trim().toLowerCase()));
}

/** Testers on a portal that isn't live yet: shown a banner and allowed unfulfilled orders. */
export function isTestMode(
  settings: { portalEnabled: boolean; testerEmails: string[] },
  email: string | null | undefined,
) {
  return !settings.portalEnabled && portalAllowed(settings, email);
}

/** The editable reward list; seeded with the starting list the first time. */
export async function rewardTypes(shop: string, { activeOnly = false } = {}) {
  if ((await db.rewardType.count({ where: { shop } })) === 0) {
    await db.rewardType.createMany({
      data: DEFAULT_REWARD_TYPES.map((t, i) => ({ ...t, shop, position: i })),
    });
  }
  return db.rewardType.findMany({
    where: { shop, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

// ---------------------------------------------------------------- eligible orders

const PORTAL_ORDERS = `#graphql
  query PortalOrders($id: ID!) {
    customer(id: $id) {
      id
      displayName
      defaultEmailAddress { emailAddress }
      orders(first: 50, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          cancelledAt
          displayFinancialStatus
          tags
          lineItems(first: 5) { nodes { title variantTitle image { url(transform: { maxWidth: 200 }) } } }
          fulfillments(first: 5) { displayStatus deliveredAt createdAt }
        }
      }
    }
  }`;

export interface PortalOrder {
  id: string;
  name: string;
  createdAt: string;
  title: string;
  image: string | null;
  deliveredAt: string | null;
}

/**
 * The customer's orders that can earn rewards: delivered (or fulfilled `eligibleDays` ago —
 * LTL carriers don't always report delivery), not cancelled or refunded, and not a
 * payment-plan installment order.
 */
export async function eligibleOrders(
  admin: AdminGraphql,
  customerId: string,
  eligibleDays: number,
  { testMode = false } = {},
) {
  const res = await admin.graphql(PORTAL_ORDERS, { variables: { id: customerId } });
  const json = (await res.json()) as {
    data?: {
      customer: {
        displayName: string;
        defaultEmailAddress: { emailAddress: string } | null;
        orders: {
          nodes: {
            id: string;
            name: string;
            createdAt: string;
            cancelledAt: string | null;
            displayFinancialStatus: string | null;
            tags: string[];
            lineItems: { nodes: { title: string; variantTitle: string | null; image: { url: string } | null }[] };
            fulfillments: { displayStatus: string | null; deliveredAt: string | null; createdAt: string }[];
          }[];
        };
      } | null;
    };
  };
  const customer = json.data?.customer;
  if (!customer) return null;

  const cutoff = Date.now() - eligibleDays * 24 * 60 * 60 * 1000;
  const orders: PortalOrder[] = [];
  for (const o of customer.orders.nodes) {
    if (o.cancelledAt) continue;
    if (o.displayFinancialStatus === "REFUNDED" || o.displayFinancialStatus === "VOIDED") continue;
    if (o.tags.includes("payment-plan-installment")) continue;
    const delivered = o.fulfillments.find((f) => f.displayStatus === "DELIVERED");
    const oldEnough = o.fulfillments.find((f) => new Date(f.createdAt).getTime() <= cutoff);
    // Soft-launch testers can use any live order, so the flow can be tried end to end.
    if (!delivered && !oldEnough && !testMode) continue;
    const line = o.lineItems.nodes[0];
    orders.push({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      title: line ? [line.title, line.variantTitle].filter(Boolean).join(" · ") : o.name,
      image: line?.image?.url ?? null,
      deliveredAt: delivered?.deliveredAt ?? oldEnough?.createdAt ?? null,
    });
  }
  return {
    name: customer.displayName,
    email: customer.defaultEmailAddress?.emailAddress ?? null,
    orders,
  };
}

// ---------------------------------------------------------------- limits

/** Why this reward type can't be started for this order, or null if it can. */
export async function submissionBlocker(shop: string, orderId: string, type: RewardType) {
  if (!type.active) return "This reward isn't available right now.";
  const settings = await rewardSettings(shop);
  const [sameType, approved] = await Promise.all([
    db.submission.count({
      where: { shop, orderId, rewardTypeId: type.id, status: { not: "REJECTED" } },
    }),
    db.submission.aggregate({ where: { shop, orderId, status: "APPROVED" }, _sum: { amount: true } }),
  ]);
  if (sameType >= type.perOrderLimit) return "You've already submitted this for this order.";
  if (Number(approved._sum.amount ?? 0) >= Number(settings.perOrderCap)) {
    return "This order has reached its reward limit.";
  }
  return null;
}

/** The most staff can approve for this submission without passing the per-order cap. */
export async function approvalHeadroom(submission: Submission) {
  const settings = await rewardSettings(submission.shop);
  const approved = await db.submission.aggregate({
    where: { shop: submission.shop, orderId: submission.orderId, status: "APPROVED", id: { not: submission.id } },
    _sum: { amount: true },
  });
  return Math.max(0, Number(settings.perOrderCap) - Number(approved._sum.amount ?? 0));
}

export function fileProblem(mimeType: string, size: number, media: RewardType["media"]) {
  const isVideo = mimeType.startsWith("video/");
  const isPhoto = mimeType.startsWith("image/");
  if (!isVideo && !isPhoto) return "Only videos and photos can be uploaded.";
  if (media === "VIDEO" && !isVideo) return "This reward needs a video.";
  if (media === "PHOTO" && !isPhoto) return "This reward needs photos.";
  if (isVideo && size > LIMITS.videoBytes) return "Videos can be up to 2 GB.";
  if (isPhoto && size > LIMITS.photoBytes) return "Photos can be up to 25 MB each.";
  return null;
}

// ---------------------------------------------------------------- drive folders

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);

/** YYYY-MM / #order – customer / reward type, inside the connected Shared Drive. */
export async function submissionFolder(submission: Submission & { rewardType: RewardType }) {
  if (submission.driveFolderId) return submission.driveFolderId;
  const conn = await db.googleConnection.findUnique({ where: { shop: submission.shop } });
  if (!conn?.sharedDriveId) throw new Error("No Shared Drive selected in Rewards settings");
  const drive = conn.sharedDriveId;
  const month = await ensureFolder(submission.shop, drive, drive, new Date().toISOString().slice(0, 7));
  const order = await ensureFolder(
    submission.shop,
    drive,
    month,
    safe(`${submission.orderName} – ${submission.customerName ?? "Customer"}`),
  );
  const folder = await ensureFolder(submission.shop, drive, order, safe(submission.rewardType.name));
  await db.submission.update({ where: { id: submission.id }, data: { driveFolderId: folder } });
  return folder;
}

export async function logSubmission(submissionId: string, type: string, message?: string, actor = "customer") {
  await db.submissionEvent.create({ data: { submissionId, type, message, actor } });
}
