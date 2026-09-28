import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { PlanStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  addProductsToGroup,
  createInstallmentProduct,
  createPaymentPlanGroup,
} from "../lib/shopify-ops.server";
import { runChargeCycle } from "../lib/charges.server";
import { formatMoney, statusTone } from "../lib/format";

const DAY = 24 * 60 * 60 * 1000;
const OPEN: PlanStatus[] = ["ACTIVE", "PAST_DUE", "PAUSED", "DEFAULTED"];
const STATUSES: PlanStatus[] = ["ACTIVE", "PAST_DUE", "PAUSED", "DEFAULTED", "COMPLETED", "CANCELLED"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const status = new URL(request.url).searchParams.get("status") as PlanStatus | null;

  const dueBetween = (days: number) =>
    db.installment.aggregate({
      where: {
        plan: { shop, status: { in: OPEN } },
        status: { in: ["SCHEDULED", "FAILED"] },
        dueDate: { lte: new Date(now.getTime() + days * DAY) },
      },
      _sum: { amount: true },
      _count: true,
    });

  const [settings, outstanding, collected, due7, due30, pastDue, counts, plans] = await Promise.all([
    db.settings.findUnique({ where: { shop } }),
    db.paymentPlan.aggregate({ where: { shop, status: { in: OPEN } }, _sum: { outstanding: true } }),
    db.installment.aggregate({
      where: { plan: { shop }, status: "PAID", paidAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    dueBetween(7),
    dueBetween(30),
    db.paymentPlan.aggregate({
      where: { shop, status: { in: ["PAST_DUE", "DEFAULTED"] } },
      _sum: { outstanding: true },
      _count: true,
    }),
    db.paymentPlan.groupBy({ by: ["status"], where: { shop }, _count: true }),
    db.paymentPlan.findMany({
      where: { shop, ...(status && STATUSES.includes(status) ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        installments: {
          where: { status: { in: ["SCHEDULED", "FAILED", "PROCESSING"] } },
          orderBy: { seq: "asc" },
          take: 1,
        },
      },
    }),
  ]);

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  return {
    configured: Boolean(settings?.sellingPlanGroupId && settings.installmentVariantId),
    kpis: {
      outstanding: String(outstanding._sum.outstanding ?? 0),
      collectedThisMonth: String(collected._sum.amount ?? 0),
      due7: String(due7._sum.amount ?? 0),
      due7Count: due7._count,
      due30: String(due30._sum.amount ?? 0),
      pastDue: String(pastDue._sum.outstanding ?? 0),
      pastDueCount: pastDue._count,
      active: (byStatus.ACTIVE ?? 0) + (byStatus.PAST_DUE ?? 0),
      completed: byStatus.COMPLETED ?? 0,
    },
    plans: plans.map((p) => ({
      id: p.id,
      orderName: p.orderName,
      customer: p.customerName ?? p.customerEmail ?? "—",
      status: p.status,
      source: p.source,
      count: p.installmentsCount,
      total: String(p.total),
      paid: String(p.paid),
      outstanding: String(p.outstanding),
      currency: p.currency,
      next: p.installments[0]
        ? { date: p.installments[0].dueDate.toISOString(), amount: String(p.installments[0].amount) }
        : null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "setup") {
    // Each step is skipped if it already ran, so a half-finished setup can be re-run.
    let settings = await db.settings.upsert({ where: { shop }, create: { shop }, update: {} });
    if (!settings.installmentVariantId) {
      const { productId, variantId } = await createInstallmentProduct(admin);
      settings = await db.settings.update({
        where: { shop },
        data: { installmentProductId: productId, installmentVariantId: variantId },
      });
    }
    if (!settings.sellingPlanGroupId) {
      const { groupId, planCounts } = await createPaymentPlanGroup(admin);
      await db.settings.update({ where: { shop }, data: { sellingPlanGroupId: groupId, planCounts } });
    }
    return { ok: true, message: "Pay in 4 / 6 / 8 created" };
  }

  if (intent === "add-products") {
    const settings = await db.settings.findUnique({ where: { shop } });
    if (!settings?.sellingPlanGroupId) return { ok: false, message: "Set up payment plans first" };
    const productIds = JSON.parse(String(form.get("productIds") ?? "[]")) as string[];
    if (productIds.length) await addProductsToGroup(admin, settings.sellingPlanGroupId, productIds);
    return { ok: true, message: `Payment plans added to ${productIds.length} product(s)` };
  }

  if (intent === "run-cycle") {
    const r = await runChargeCycle(admin, shop);
    return {
      ok: true,
      message: `Charged ${r.charged}, paid ${r.succeeded}, failed ${r.failed}, pending ${r.pending}`,
    };
  }

  return { ok: false, message: "Unknown action" };
};

export default function Dashboard() {
  const { configured, kpis, plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [params, setParams] = useSearchParams();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  const pickProducts = async () => {
    const selection = await shopify.resourcePicker({ type: "product", multiple: true });
    if (!selection?.length) return;
    fetcher.submit(
      { intent: "add-products", productIds: JSON.stringify(selection.map((p) => p.id)) },
      { method: "POST" },
    );
  };

  const money = (v: string) => formatMoney(v, "USD");

  return (
    <s-page heading="Payment plans">
      {configured ? (
        <>
          <s-button slot="primary-action" onClick={pickProducts} {...(busy ? { loading: true } : {})}>
            Offer on products
          </s-button>
          <s-button
            slot="secondary-actions"
            onClick={() => fetcher.submit({ intent: "run-cycle" }, { method: "POST" })}
          >
            Run charges now
          </s-button>
        </>
      ) : (
        <s-banner tone="info" heading="Set up Pay in 4 / 6 / 8">
          <s-paragraph>
            Creates the payment-plan purchase options in Shopify: first payment at checkout,
            the rest charged monthly to the saved card, and orders held until paid in full.
          </s-paragraph>
          <s-button
            slot="secondary-actions"
            onClick={() => fetcher.submit({ intent: "setup" }, { method: "POST" })}
            {...(busy ? { loading: true } : {})}
          >
            Create payment plans
          </s-button>
        </s-banner>
      )}

      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Stat label="Outstanding" value={money(kpis.outstanding)} />
          <Stat label="Collected this month" value={money(kpis.collectedThisMonth)} />
          <Stat label={`Due in 7 days (${kpis.due7Count})`} value={money(kpis.due7)} />
          <Stat label="Due in 30 days" value={money(kpis.due30)} />
          <Stat
            label={`Past due (${kpis.pastDueCount})`}
            value={money(kpis.pastDue)}
            tone={kpis.pastDueCount ? "critical" : undefined}
          />
          <Stat label="Active / completed" value={`${kpis.active} / ${kpis.completed}`} />
        </s-grid>
      </s-section>

      <s-section heading="Plans" padding="none">
        <s-box padding="base">
          <s-stack direction="inline" gap="small-200">
            {[null, ...STATUSES].map((s) => (
              <s-button
                key={s ?? "all"}
                variant={(params.get("status") ?? null) === s ? "primary" : "secondary"}
                onClick={() => setParams(s ? { status: s } : {})}
              >
                {s ? s.replace("_", " ").toLowerCase() : "all"}
              </s-button>
            ))}
          </s-stack>
        </s-box>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Order</s-table-header>
            <s-table-header>Customer</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Plan</s-table-header>
            <s-table-header format="currency">Paid</s-table-header>
            <s-table-header format="currency">Outstanding</s-table-header>
            <s-table-header>Next payment</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {plans.map((p) => (
              <s-table-row key={p.id}>
                <s-table-cell>
                  <Link to={`/app/plans/${p.id}`}>{p.orderName}</Link>
                </s-table-cell>
                <s-table-cell>{p.customer}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={statusTone(p.status)}>{p.status.replace("_", " ").toLowerCase()}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  Pay in {p.count}
                  {p.source === "REP" ? " · rep" : ""}
                </s-table-cell>
                <s-table-cell>{formatMoney(p.paid, p.currency)}</s-table-cell>
                <s-table-cell>{formatMoney(p.outstanding, p.currency)}</s-table-cell>
                <s-table-cell>
                  {p.next
                    ? `${new Date(p.next.date).toLocaleDateString()} · ${formatMoney(p.next.amount, p.currency)}`
                    : "—"}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {plans.length === 0 && (
          <s-box padding="base">
            <s-text color="subdued">No payment plans yet.</s-text>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "critical" }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>
          <s-text tone={tone}>{value}</s-text>
        </s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
