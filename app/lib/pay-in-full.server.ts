// "Pay in full" discount: an automatic discount on the payment-plan products that only
// applies to one-time purchases (never to the Pay-in-N plans), plus a shop metafield the
// theme reads so the Pay in full card shows the same saving checkout will apply.
import db from "../db.server";
import { ShopifyUserError, type AdminGraphql } from "./shopify-ops.server";

export type PayInFullType = "none" | "percent" | "amount";
export const METAFIELD = { namespace: "payment_plans", key: "pay_in_full" } as const;

async function gql<T>(admin: AdminGraphql, query: string, variables: Record<string, unknown> = {}) {
  const res = await admin.graphql(query, { variables });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors || !json.data) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function check(op: string, payload: { userErrors: { field?: string[] | null; message: string; code?: string | null }[] }) {
  if (payload.userErrors.length) throw new ShopifyUserError(op, payload.userErrors);
}

export const payInFullTitle = (type: PayInFullType, value: number) =>
  type === "percent"
    ? `Pay in full: ${value}% off`
    : `Pay in full: $${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} off`;

async function planProductIds(admin: AdminGraphql, groupId: string) {
  const data = await gql<{ sellingPlanGroup: { products: { nodes: { id: string }[] } } | null }>(
    admin,
    `#graphql
      query GroupProducts($id: ID!) {
        sellingPlanGroup(id: $id) { products(first: 250) { nodes { id } } }
      }`,
    { id: groupId },
  );
  return data.sellingPlanGroup?.products.nodes.map((p) => p.id) ?? [];
}

/** Lets theme Liquid read shop.metafields.payment_plans.pay_in_full (once per shop). */
async function ensureMetafieldDefinition(admin: AdminGraphql) {
  const data = await gql<{
    metafieldDefinitionCreate: { userErrors: { field: string[] | null; message: string; code: string | null }[] };
  }>(
    admin,
    `#graphql
      mutation DefinePayInFullMetafield($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { field message code }
        }
      }`,
    {
      definition: {
        name: "Pay in full discount",
        description: "Set by the Payment Plans app. Read by the product page's payment plan step.",
        namespace: METAFIELD.namespace,
        key: METAFIELD.key,
        type: "json",
        ownerType: "SHOP",
        access: { storefront: "PUBLIC_READ" },
      },
    },
  );
  const errors = data.metafieldDefinitionCreate.userErrors.filter((e) => e.code !== "TAKEN");
  check("metafieldDefinitionCreate", { userErrors: errors });
}

async function writeMetafield(admin: AdminGraphql, type: PayInFullType, value: number) {
  const { shop } = await gql<{ shop: { id: string } }>(admin, `#graphql
    query ShopId { shop { id } }`);
  const data = await gql<{
    metafieldsSet: { userErrors: { field: string[] | null; message: string; code: string | null }[] };
  }>(
    admin,
    `#graphql
      mutation SetPayInFullMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message code }
        }
      }`,
    {
      metafields: [
        {
          ownerId: shop.id,
          namespace: METAFIELD.namespace,
          key: METAFIELD.key,
          type: "json",
          value: JSON.stringify({ type, value }),
        },
      ],
    },
  );
  check("metafieldsSet", data.metafieldsSet);
}

const CREATE = `#graphql
  mutation CreatePayInFullDiscount($input: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $input) {
      automaticDiscountNode { id }
      userErrors { field message code }
    }
  }`;

const UPDATE = `#graphql
  mutation UpdatePayInFullDiscount($id: ID!, $input: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $input) {
      automaticDiscountNode { id }
      userErrors { field message code }
    }
  }`;

/**
 * Applies the saved Pay in full setting to Shopify: creates/updates the automatic discount
 * (or deactivates it for "none") and publishes the value for the theme. Re-run it after
 * products are added to the payment plans so they get the discount too.
 */
export async function syncPayInFull(admin: AdminGraphql, shop: string) {
  const settings = await db.settings.findUnique({ where: { shop } });
  if (!settings?.sellingPlanGroupId) throw new Error("Set up payment plans first");
  const type = settings.payInFullType as PayInFullType;
  const value = Number(settings.payInFullValue ?? 0);

  await ensureMetafieldDefinition(admin);

  if (type === "none" || value <= 0) {
    if (settings.payInFullDiscountId) {
      const data = await gql<{ discountAutomaticDeactivate: { userErrors: { message: string }[] } }>(
        admin,
        `#graphql
        mutation DeactivatePayInFull($id: ID!) {
          discountAutomaticDeactivate(id: $id) { userErrors { field message } }
        }`,
        { id: settings.payInFullDiscountId },
      );
      check("discountAutomaticDeactivate", data.discountAutomaticDeactivate);
    }
    await writeMetafield(admin, "none", 0);
    return;
  }

  const productIds = await planProductIds(admin, settings.sellingPlanGroupId);
  const input = {
    title: payInFullTitle(type, value),
    startsAt: new Date().toISOString(),
    endsAt: null,
    // No stacking with product/order discount codes; Shopify applies whichever is better.
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    customerGets: {
      value:
        type === "percent"
          ? { percentage: value / 100 }
          : { discountAmount: { amount: value.toFixed(2), appliesOnEachItem: true } },
      items: { products: { productsToAdd: productIds } },
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: false,
    },
  };

  let discountId = settings.payInFullDiscountId;
  if (discountId) {
    const data = await gql<{
      discountAutomaticBasicUpdate: { userErrors: { field: string[] | null; message: string; code: string | null }[] };
    }>(admin, UPDATE, { id: discountId, input });
    check("discountAutomaticBasicUpdate", data.discountAutomaticBasicUpdate);
    // An update doesn't reactivate a discount that was switched off.
    const activated = await gql<{ discountAutomaticActivate: { userErrors: { message: string }[] } }>(
      admin,
      `#graphql
        mutation ActivatePayInFull($id: ID!) {
        discountAutomaticActivate(id: $id) { userErrors { field message } }
      }`,
      { id: discountId },
    );
    // Already-active discounts can report an error here; that's fine, the update went through.
    if (activated.discountAutomaticActivate.userErrors.length) {
      console.warn("[pay-in-full] activate:", activated.discountAutomaticActivate.userErrors);
    }
  } else {
    const data = await gql<{
      discountAutomaticBasicCreate: {
        automaticDiscountNode: { id: string } | null;
        userErrors: { field: string[] | null; message: string; code: string | null }[];
      };
    }>(admin, CREATE, { input });
    check("discountAutomaticBasicCreate", data.discountAutomaticBasicCreate);
    discountId = data.discountAutomaticBasicCreate.automaticDiscountNode!.id;
    await db.settings.update({ where: { shop }, data: { payInFullDiscountId: discountId } });
  }

  await writeMetafield(admin, type, value);
}
