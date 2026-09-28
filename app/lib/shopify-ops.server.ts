// Admin GraphQL operations used by the payment-plan engine (validated against 2026-07).
//
// How a plan works in Shopify (non-Plus stores can't charge part of an order's balance):
//  - The product is sold on a subscription-style selling plan: 1/N of the price per month for
//    N cycles. Checkout charges cycle 1 and creates the order that holds the deck.
//  - The app then swaps the contract's line for a hidden "Payment plan installment" item
//    (no stock, no shipping) so each monthly billing creates a small payment-only order.
//  - When the last cycle is paid, the original order's fulfillment hold is released.

export interface AdminGraphql {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

type UserErrors = { field?: string[] | null; message: string; code?: string | null }[];

export class ShopifyUserError extends Error {
  constructor(
    public op: string,
    public userErrors: UserErrors,
  ) {
    super(`${op}: ${userErrors.map((e) => e.message).join("; ")}`);
  }
}

async function run<T>(
  admin: AdminGraphql,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors || !json.data) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/** Runs a mutation and throws if its payload (data[op]) has userErrors. */
async function mutate<P extends { userErrors: UserErrors }>(
  admin: AdminGraphql,
  op: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<P> {
  const data = await run<Record<string, P>>(admin, query, variables);
  const payload = data[op];
  if (payload.userErrors.length) throw new ShopifyUserError(op, payload.userErrors);
  return payload;
}

// ---------------------------------------------------------------- selling plans

export const PLAN_COUNTS = [4, 6, 8] as const;

// Shown under the product in cart and checkout.
export const planName = (n: number) => `Pay in ${n}: 1/${n} today, then ${n - 1} monthly payments`;
export const planDescription = (n: number) =>
  `Pay 1/${n} today. The rest is charged to the same card in ${n - 1} equal monthly ` +
  `payments. Your order ships once it's paid in full. No fees or interest.`;

const CREATE_GROUP = `#graphql
  mutation CreatePaymentPlanGroup($input: SellingPlanGroupInput!) {
    sellingPlanGroupCreate(input: $input) {
      sellingPlanGroup { id sellingPlans(first: 20) { nodes { id name options } } }
      userErrors { field message code }
    }
  }`;

export async function createPaymentPlanGroup(
  admin: AdminGraphql,
  counts: readonly number[] = PLAN_COUNTS,
) {
  const input = {
    name: "Payment plans",
    merchantCode: "Payment plans",
    options: ["Payment plan"],
    position: 1,
    sellingPlansToCreate: counts.map((n, i) => ({
      name: planName(n),
      description: planDescription(n),
      options: [`Pay in ${n}`],
      position: i + 1,
      category: "SUBSCRIPTION",
      billingPolicy: {
        recurring: { interval: "MONTH", intervalCount: 1, minCycles: n, maxCycles: n },
      },
      deliveryPolicy: { recurring: { interval: "MONTH", intervalCount: 1 } },
      // Each cycle is 1/N of the price. Rounding is corrected on the last installment.
      pricingPolicies: [
        {
          fixed: {
            adjustmentType: "PERCENTAGE",
            adjustmentValue: { percentage: Math.round((100 - 100 / n) * 10000) / 10000 },
          },
        },
      ],
    })),
  };

  const { sellingPlanGroup } = await mutate<{
    sellingPlanGroup: {
      id: string;
      sellingPlans: { nodes: { id: string; options: string[] }[] };
    };
    userErrors: UserErrors;
  }>(admin, "sellingPlanGroupCreate", CREATE_GROUP, { input });

  const planCounts: Record<string, number> = {};
  for (const plan of sellingPlanGroup.sellingPlans.nodes) {
    const n = Number(plan.options[0]?.match(/\d+/)?.[0]);
    if (n) planCounts[plan.id] = n;
  }
  return { groupId: sellingPlanGroup.id, planCounts };
}

const ADD_PRODUCTS = `#graphql
  mutation AddProductsToPaymentPlans($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
      sellingPlanGroup { id }
      userErrors { field message code }
    }
  }`;

export async function addProductsToGroup(admin: AdminGraphql, groupId: string, productIds: string[]) {
  await mutate(admin, "sellingPlanGroupAddProducts", ADD_PRODUCTS, { id: groupId, productIds });
}

// ---------------------------------------------------------------- installment product

const CREATE_PRODUCT = `#graphql
  mutation CreateInstallmentProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id variants(first: 1) { nodes { id } } }
      userErrors { field message }
    }
  }`;

const CONFIGURE_VARIANT = `#graphql
  mutation ConfigureInstallmentVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }`;

/**
 * The line monthly payment orders are billed for. Not published to any sales channel, not
 * stock-tracked and doesn't need shipping; taxable, so each payment carries its share of tax.
 */
export async function createInstallmentProduct(admin: AdminGraphql) {
  const { product } = await mutate<{
    product: { id: string; variants: { nodes: { id: string }[] } };
    userErrors: UserErrors;
  }>(admin, "productCreate", CREATE_PRODUCT, {
    product: {
      title: "Payment plan installment",
      descriptionHtml: "<p>Monthly payment toward a payment-plan order. Created by the Payment Plans app — don't delete.</p>",
      productType: "Payment plan",
      status: "ACTIVE",
      tags: ["payment-plan-internal"],
    },
  });
  const variantId = product.variants.nodes[0].id;
  await mutate(admin, "productVariantsBulkUpdate", CONFIGURE_VARIANT, {
    productId: product.id,
    variants: [
      {
        id: variantId,
        price: "0.00",
        taxable: true,
        inventoryItem: { requiresShipping: false, tracked: false },
      },
    ],
  });
  return { productId: product.id, variantId };
}

// ---------------------------------------------------------------- subscription contracts

const CONTRACT = `#graphql
  query PlanContract($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      currencyCode
      originOrder { id }
      customer { id displayName defaultEmailAddress { emailAddress } }
      customerPaymentMethod { id revokedAt }
      billingPolicy { interval intervalCount maxCycles }
      deliveryPrice { amount }
      lines(first: 10) {
        nodes {
          id
          variantId
          quantity
          sellingPlanId
          currentPrice { amount }
          pricingPolicy { basePrice { amount } }
        }
      }
    }
  }`;

export interface PlanContract {
  id: string;
  status: string;
  currencyCode: string;
  originOrder: { id: string } | null;
  customer: {
    id: string;
    displayName: string;
    defaultEmailAddress: { emailAddress: string } | null;
  } | null;
  customerPaymentMethod: { id: string; revokedAt: string | null } | null;
  billingPolicy: { interval: string; intervalCount: number; maxCycles: number | null };
  deliveryPrice: { amount: string };
  lines: {
    nodes: {
      id: string;
      variantId: string | null;
      quantity: number;
      sellingPlanId: string | null;
      currentPrice: { amount: string };
      pricingPolicy: { basePrice: { amount: string } } | null;
    }[];
  };
}

export async function fetchContract(admin: AdminGraphql, id: string) {
  const data = await run<{ subscriptionContract: PlanContract | null }>(admin, CONTRACT, { id });
  return data.subscriptionContract;
}

const DRAFT_BEGIN = `#graphql
  mutation BeginContractEdit($contractId: ID!) {
    subscriptionContractUpdate(contractId: $contractId) {
      draft { id }
      userErrors { field message code }
    }
  }`;

const DRAFT_LINE = `#graphql
  mutation SwapToInstallment($draftId: ID!, $lineId: ID!, $input: SubscriptionLineUpdateInput!) {
    subscriptionDraftLineUpdate(draftId: $draftId, lineId: $lineId, input: $input) {
      lineUpdated { id }
      userErrors { field message code }
    }
  }`;

const DRAFT_UPDATE = `#graphql
  mutation ZeroShipping($draftId: ID!, $input: SubscriptionDraftInput!) {
    subscriptionDraftUpdate(draftId: $draftId, input: $input) {
      draft { id }
      userErrors { field message code }
    }
  }`;

const DRAFT_COMMIT = `#graphql
  mutation CommitContractEdit($draftId: ID!) {
    subscriptionDraftCommit(draftId: $draftId) {
      contract { id status }
      userErrors { field message code }
    }
  }`;

/**
 * Edits the contract's single line: optionally swaps the product, and sets the price the
 * next billing charges. The first edit also zeroes recurring shipping and adds an order note.
 */
export async function editContractLine(
  admin: AdminGraphql,
  args: {
    contractId: string;
    lineId: string;
    price: string;
    variantId?: string;
    draft?: { deliveryPrice?: string; note?: string };
  },
) {
  const { draft } = await mutate<{ draft: { id: string }; userErrors: UserErrors }>(
    admin,
    "subscriptionContractUpdate",
    DRAFT_BEGIN,
    { contractId: args.contractId },
  );
  await mutate(admin, "subscriptionDraftLineUpdate", DRAFT_LINE, {
    draftId: draft.id,
    lineId: args.lineId,
    input: {
      currentPrice: args.price,
      ...(args.variantId ? { productVariantId: args.variantId, quantity: 1 } : {}),
    },
  });
  if (args.draft) {
    await mutate(admin, "subscriptionDraftUpdate", DRAFT_UPDATE, {
      draftId: draft.id,
      input: args.draft,
    });
  }
  await mutate(admin, "subscriptionDraftCommit", DRAFT_COMMIT, { draftId: draft.id });
}

const EXPIRE = `#graphql
  mutation EndContract($id: ID!) {
    subscriptionContractExpire(subscriptionContractId: $id) {
      contract { id status }
      userErrors { field message code }
    }
  }`;

const CANCEL = `#graphql
  mutation CancelContract($id: ID!) {
    subscriptionContractCancel(subscriptionContractId: $id) {
      contract { id status }
      userErrors { field message code }
    }
  }`;

export async function endContract(admin: AdminGraphql, id: string, how: "expire" | "cancel") {
  if (how === "expire") await mutate(admin, "subscriptionContractExpire", EXPIRE, { id });
  else await mutate(admin, "subscriptionContractCancel", CANCEL, { id });
}

// ---------------------------------------------------------------- billing

const BILL = `#graphql
  mutation BillInstallment($contractId: ID!, $input: SubscriptionBillingAttemptInput!) {
    subscriptionBillingAttemptCreate(subscriptionContractId: $contractId, subscriptionBillingAttemptInput: $input) {
      subscriptionBillingAttempt { id }
      userErrors { field message code }
    }
  }`;

const BILLING_CYCLE = `#graphql
  query BillingCycle($contractId: ID!, $index: Int!) {
    subscriptionBillingCycle(billingCycleInput: { contractId: $contractId, selector: { index: $index } }) {
      cycleStartAt
      cycleEndAt
    }
  }`;

/**
 * Bills installment `seq` of a plan. Shopify numbers cycles from the first one *after*
 * checkout, so installment 2 is cycle 1. The origin time must fall inside that cycle, so an
 * early charge ("charge now") uses the cycle's start and a late one its end. The idempotency
 * key makes resends safe.
 */
export async function billCycle(
  admin: AdminGraphql,
  args: { contractId: string; seq: number; key: string; now?: Date },
) {
  const index = args.seq - 1;
  const { subscriptionBillingCycle: cycle } = await run<{
    subscriptionBillingCycle: { cycleStartAt: string; cycleEndAt: string } | null;
  }>(admin, BILLING_CYCLE, { contractId: args.contractId, index });
  if (!cycle) throw new Error(`Contract has no billing cycle ${index}`);

  const now = (args.now ?? new Date()).getTime();
  const start = new Date(cycle.cycleStartAt).getTime();
  const end = new Date(cycle.cycleEndAt).getTime();
  const originTime = new Date(Math.min(Math.max(now, start), end)).toISOString();

  const { subscriptionBillingAttempt } = await mutate<{
    subscriptionBillingAttempt: { id: string } | null;
    userErrors: UserErrors;
  }>(admin, "subscriptionBillingAttemptCreate", BILL, {
    contractId: args.contractId,
    input: { idempotencyKey: args.key, originTime, billingCycleSelector: { index } },
  });
  if (!subscriptionBillingAttempt) throw new Error("No billing attempt returned");
  return subscriptionBillingAttempt.id;
}

const BILLING_ATTEMPT = `#graphql
  query BillingAttempt($id: ID!) {
    subscriptionBillingAttempt(id: $id) {
      id
      state {
        __typename
        ... on SubscriptionBillingAttemptSuccessState { order { id name totalPriceSet { shopMoney { amount } } } }
        ... on SubscriptionBillingAttemptFailedState {
          error {
            __typename
            ... on SubscriptionBillingAttemptPaymentError { paymentCode: code }
            ... on SubscriptionBillingAttemptGeneralError { generalCode: code }
            ... on SubscriptionBillingAttemptInventoryError { inventoryCode: code }
            ... on SubscriptionBillingAttemptUnexpectedError { message }
          }
        }
        ... on SubscriptionBillingAttemptPendingState { processing }
      }
    }
  }`;

export type BillingOutcome =
  | { outcome: "succeeded"; orderId: string; orderName: string; orderTotal: string }
  | { outcome: "failed"; error: string }
  | { outcome: "pending" };

export async function fetchBillingOutcome(admin: AdminGraphql, id: string): Promise<BillingOutcome> {
  const data = await run<{
    subscriptionBillingAttempt: {
      state: {
        __typename: string;
        order?: { id: string; name: string; totalPriceSet: { shopMoney: { amount: string } } };
        error?: {
          __typename: string;
          paymentCode?: string;
          generalCode?: string;
          inventoryCode?: string;
          message?: string;
        };
      };
    } | null;
  }>(admin, BILLING_ATTEMPT, { id });

  const state = data.subscriptionBillingAttempt?.state;
  switch (state?.__typename) {
    case "SubscriptionBillingAttemptSuccessState":
      return {
        outcome: "succeeded",
        orderId: state.order!.id,
        orderName: state.order!.name,
        orderTotal: state.order!.totalPriceSet.shopMoney.amount,
      };
    case "SubscriptionBillingAttemptFailedState": {
      const e = state.error;
      const code = e?.paymentCode ?? e?.generalCode ?? e?.inventoryCode ?? e?.message ?? "unknown";
      return { outcome: "failed", error: code };
    }
    case "SubscriptionBillingAttemptActionRequiredState":
      // e.g. the bank wants 3-D Secure; the customer has to confirm the payment themselves.
      return { outcome: "failed", error: "CUSTOMER_ACTION_REQUIRED" };
    default:
      return { outcome: "pending" };
  }
}

// ---------------------------------------------------------------- orders

const PLAN_ORDER = `#graphql
  query PlanOrder($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      cancelledAt
      fulfillmentOrders(first: 20) {
        nodes { id status fulfillmentHolds { id handle reason heldByRequestingApp } }
      }
    }
  }`;

export interface PlanOrder {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  fulfillmentOrders: {
    nodes: {
      id: string;
      status: string;
      fulfillmentHolds: { id: string; handle: string | null; reason: string; heldByRequestingApp: boolean }[];
    }[];
  };
}

export async function fetchPlanOrder(admin: AdminGraphql, orderId: string) {
  const data = await run<{ order: PlanOrder | null }>(admin, PLAN_ORDER, { id: orderId });
  return data.order;
}

const TAGS_ADD = `#graphql
  mutation TagOrder($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }`;

export async function tagOrder(admin: AdminGraphql, id: string, tags: string[]) {
  await mutate(admin, "tagsAdd", TAGS_ADD, { id, tags });
}

// ---------------------------------------------------------------- fulfillment gate

export const HOLD_HANDLE = "payment-plan";

const HOLD = `#graphql
  mutation HoldForPlan($id: ID!, $hold: FulfillmentOrderHoldInput!) {
    fulfillmentOrderHold(id: $id, fulfillmentHold: $hold) {
      fulfillmentHold { id }
      userErrors { field message }
    }
  }`;

const RELEASE = `#graphql
  mutation ReleasePlanHold($id: ID!, $holdIds: [ID!]) {
    fulfillmentOrderReleaseHold(id: $id, holdIds: $holdIds) {
      fulfillmentOrder { id status }
      userErrors { field message }
    }
  }`;

const OPEN_STATUSES = new Set(["OPEN", "SCHEDULED", "ON_HOLD", "IN_PROGRESS"]);

/** Puts every unfulfilled fulfillment order on hold (skips ones we already hold). */
export async function holdFulfillment(admin: AdminGraphql, order: PlanOrder) {
  for (const fo of order.fulfillmentOrders.nodes) {
    if (!OPEN_STATUSES.has(fo.status)) continue;
    if (fo.fulfillmentHolds.some((h) => h.heldByRequestingApp && h.handle === HOLD_HANDLE)) continue;
    await mutate(admin, "fulfillmentOrderHold", HOLD, {
      id: fo.id,
      hold: {
        reason: "AWAITING_PAYMENT",
        reasonNotes: "Payment plan: ships once the balance is paid in full",
        handle: HOLD_HANDLE,
        notifyMerchant: false,
      },
    });
  }
}

/** Releases only this app's payment-plan holds; fraud/address/staff holds stay. */
export async function releaseFulfillment(admin: AdminGraphql, order: PlanOrder) {
  for (const fo of order.fulfillmentOrders.nodes) {
    const ours = fo.fulfillmentHolds.filter((h) => h.heldByRequestingApp && h.handle === HOLD_HANDLE);
    if (!ours.length) continue;
    await mutate(admin, "fulfillmentOrderReleaseHold", RELEASE, {
      id: fo.id,
      holdIds: ours.map((h) => h.id),
    });
  }
}
