import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { audit, refreshPlan, syncWithOriginOrder } from "../lib/plans.server";
import { runChargeCycle } from "../lib/charges.server";
import { formatMoney, statusTone } from "../lib/format";

async function loadPlan(shop: string, id: string) {
  const plan = await db.paymentPlan.findFirst({
    where: { id, shop },
    include: {
      installments: { orderBy: { seq: "asc" } },
      events: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!plan) throw new Response("Not found", { status: 404 });
  return plan;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plan = await loadPlan(session.shop, params.id!);
  return {
    plan: {
      id: plan.id,
      orderId: plan.orderId,
      orderName: plan.orderName,
      customer: plan.customerName ?? plan.customerEmail ?? "—",
      email: plan.customerEmail,
      status: plan.status,
      source: plan.source,
      count: plan.installmentsCount,
      currency: plan.currency,
      total: String(plan.total),
      paid: String(plan.paid),
      outstanding: String(plan.outstanding),
      hasContract: Boolean(plan.contractId),
      fulfillmentHeld: plan.fulfillmentHeld,
    },
    installments: plan.installments.map((i) => ({
      id: i.id,
      seq: i.seq,
      dueDate: i.dueDate.toISOString(),
      amount: String(i.amount),
      status: i.status,
      attempts: i.attempts,
      lastError: i.lastError,
      nextAttemptAt: i.nextAttemptAt?.toISOString() ?? null,
      paidAt: i.paidAt?.toISOString() ?? null,
      chargeOrderId: i.chargeOrderId,
      chargeOrderName: i.chargeOrderName,
    })),
    events: plan.events.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticate.admin(request);
  const plan = await loadPlan(session.shop, params.id!);
  // The staff member's user id from the App Bridge session token.
  const actor = sessionToken?.sub ? `staff:${sessionToken.sub}` : "staff";
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "charge-now") {
    if (!["ACTIVE", "PAST_DUE"].includes(plan.status)) {
      return { ok: false, message: `Plan is ${plan.status.toLowerCase()}` };
    }
    const next = plan.installments.find((i) => i.status === "SCHEDULED" || i.status === "FAILED");
    if (!next) return { ok: false, message: "Nothing left to charge" };
    await db.installment.update({
      where: { id: next.id },
      data: next.status === "FAILED" ? { nextAttemptAt: new Date() } : { dueDate: new Date() },
    });
    await audit(plan.id, "charge_now", `Installment ${next.seq} charged early by staff`, undefined, actor);
    await runChargeCycle(admin, session.shop);
    return { ok: true, message: "Charge started — refresh in a moment for the result" };
  }

  if (intent === "pause" || intent === "resume") {
    const status = intent === "pause" ? "PAUSED" : "ACTIVE";
    await db.paymentPlan.update({ where: { id: plan.id }, data: { status } });
    await audit(plan.id, intent === "pause" ? "plan_paused" : "plan_resumed", undefined, undefined, actor);
    return { ok: true, message: intent === "pause" ? "Plan paused" : "Plan resumed" };
  }

  if (intent === "sync") {
    await syncWithOriginOrder(admin, plan);
    await refreshPlan(admin, plan.id);
    return { ok: true, message: "Synced with Shopify" };
  }

  if (intent === "note") {
    const note = String(form.get("note") ?? "").trim();
    if (note) await audit(plan.id, "note", note, undefined, actor);
    return { ok: true, message: "Note added" };
  }

  return { ok: false, message: "Unknown action" };
};

export default function PlanDetail() {
  const { plan, installments, events } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const act = (intent: string) => fetcher.submit({ intent }, { method: "POST" });
  const money = (v: string) => formatMoney(v, plan.currency);
  const orderNumericId = plan.orderId.split("/").pop();

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  return (
    <s-page heading={`${plan.orderName} · Pay in ${plan.count}`}>
      <s-link slot="breadcrumb-actions" href="/app">Payment plans</s-link>
      <s-button slot="primary-action" onClick={() => act("charge-now")}>
        Charge next installment now
      </s-button>
      <s-button slot="secondary-actions" onClick={() => act(plan.status === "PAUSED" ? "resume" : "pause")}>
        {plan.status === "PAUSED" ? "Resume" : "Pause"}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => act("sync")}>
        Sync with Shopify
      </s-button>
      <s-button slot="secondary-actions" href={`shopify://admin/orders/${orderNumericId}`} target="_blank">
        Open order
      </s-button>

      {!plan.hasContract && (
        <s-banner tone="critical" heading="No billing contract for this plan">
          <s-paragraph>
            Installments can&apos;t be charged automatically. Collect the balance another way.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="Summary">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Field label="Status">
            <s-badge tone={statusTone(plan.status)}>{plan.status.replace("_", " ").toLowerCase()}</s-badge>
          </Field>
          <Field label="Customer">{plan.customer}</Field>
          <Field label="Total">{money(plan.total)}</Field>
          <Field label="Paid">{money(plan.paid)}</Field>
          <Field label="Outstanding">{money(plan.outstanding)}</Field>
          <Field label="Fulfillment">{plan.fulfillmentHeld ? "On hold until paid" : "Released"}</Field>
        </s-grid>
      </s-section>

      <s-section heading="Schedule" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">#</s-table-header>
            <s-table-header>Due</s-table-header>
            <s-table-header format="currency">Amount</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Details</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {installments.map((i) => (
              <s-table-row key={i.id}>
                <s-table-cell>{i.seq === 1 ? "1 (checkout)" : i.seq}</s-table-cell>
                <s-table-cell>{new Date(i.dueDate).toLocaleDateString()}</s-table-cell>
                <s-table-cell>{money(i.amount)}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={statusTone(i.status)}>{i.status.toLowerCase()}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  {i.paidAt
                    ? `Paid ${new Date(i.paidAt).toLocaleDateString()}${i.chargeOrderName ? ` · ${i.chargeOrderName}` : ""}`
                    : i.status === "FAILED"
                      ? `${i.lastError ?? "Failed"}${i.nextAttemptAt ? ` · retry ${new Date(i.nextAttemptAt).toLocaleDateString()}` : ""}`
                      : i.attempts
                        ? `${i.attempts} attempt(s)`
                        : ""}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Activity">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="note" />
          <s-stack direction="inline" gap="small-200">
            <s-text-field name="note" label="Add a note" labelAccessibilityVisibility="exclusive" placeholder="Add a note" />
            <s-button type="submit">Add note</s-button>
          </s-stack>
        </fetcher.Form>
        <s-stack gap="small-200">
          {events.map((e) => (
            <s-box key={e.id} paddingBlock="small-200" borderWidth="none none base none">
              <s-text color="subdued">
                {new Date(e.createdAt).toLocaleString()} · {e.actor}
              </s-text>
              <s-paragraph>
                <s-text type="strong">{e.type.replaceAll("_", " ")}</s-text>
                {e.message ? ` — ${e.message}` : ""}
              </s-paragraph>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <s-stack gap="small-300">
      <s-text color="subdued">{label}</s-text>
      <s-text>{children}</s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
