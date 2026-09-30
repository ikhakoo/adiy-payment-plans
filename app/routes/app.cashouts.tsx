import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { CashoutStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { creditSubmission } from "../lib/ledger.server";
import { rewardSettings } from "../lib/rewards.server";
import { formatMoney } from "../lib/format";

const TABS: { status: CashoutStatus; label: string }[] = [
  { status: "REQUESTED", label: "To send" },
  { status: "SENT", label: "Sent" },
  { status: "CANCELLED", label: "Cancelled" },
];

/** Approvals from before the ledger existed get their credit (idempotent per submission). */
async function backfillCredits(shop: string) {
  const missing = await db.submission.findMany({
    where: { shop, status: "APPROVED", amount: { not: null } },
    include: { rewardType: true },
  });
  const existing = new Set(
    (await db.rewardCredit.findMany({ where: { shop, submissionId: { not: null } }, select: { submissionId: true } }))
      .map((c) => c.submissionId),
  );
  const { holdDays } = await rewardSettings(shop);
  for (const s of missing.filter((m) => !existing.has(m.id))) {
    await creditSubmission(s, Number(s.amount), holdDays, s.reviewedBy ?? "system");
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  await backfillCredits(shop);
  const status = (new URL(request.url).searchParams.get("status") as CashoutStatus) || "REQUESTED";
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [rows, waiting, sentMonth, owedReady, owedPending, counts] = await Promise.all([
    db.cashout.findMany({
      where: { shop, status },
      orderBy: { requestedAt: status === "REQUESTED" ? "asc" : "desc" },
      take: 500,
    }),
    db.cashout.aggregate({ where: { shop, status: "REQUESTED" }, _sum: { amount: true } }),
    db.cashout.aggregate({ where: { shop, status: "SENT", sentAt: { gte: monthStart } }, _sum: { amount: true } }),
    db.rewardCredit.aggregate({ where: { shop, cancelledAt: null, availableAt: { lte: new Date() } }, _sum: { amount: true } }),
    db.rewardCredit.aggregate({ where: { shop, cancelledAt: null, availableAt: { gt: new Date() } }, _sum: { amount: true } }),
    db.cashout.groupBy({ by: ["status"], where: { shop }, _count: true }),
  ]);
  const allCashedOrReserved = await db.cashout.aggregate({
    where: { shop, status: { in: ["REQUESTED", "SENT"] } },
    _sum: { amount: true },
  });

  return {
    status,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>,
    totals: {
      waiting: String(waiting._sum.amount ?? 0),
      sentThisMonth: String(sentMonth._sum.amount ?? 0),
      // Everything customers could still cash out, plus what's still on hold.
      owedAvailable: String(Number(owedReady._sum.amount ?? 0) - Number(allCashedOrReserved._sum.amount ?? 0)),
      owedPending: String(owedPending._sum.amount ?? 0),
    },
    rows: rows.map((c) => ({
      id: c.id,
      customer: c.customerName ?? "Customer",
      email: c.email,
      amount: String(c.amount),
      requestedAt: c.requestedAt.toISOString(),
      sentAt: c.sentAt?.toISOString() ?? null,
      amazonOrderRef: c.amazonOrderRef,
      cancelReason: c.cancelReason,
      handledBy: c.handledBy,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const actor = sessionToken?.sub ? `staff:${sessionToken.sub}` : "staff";
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");

  if (intent === "sent") {
    const res = await db.cashout.updateMany({
      where: { id, shop: session.shop, status: "REQUESTED" },
      data: {
        status: "SENT",
        sentAt: new Date(),
        handledBy: actor,
        amazonOrderRef: String(form.get("amazonOrderRef") ?? "").trim() || null,
      },
    });
    return res.count ? { ok: true, message: "Marked as sent" } : { ok: false, message: "Already handled" };
  }

  if (intent === "cancel") {
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return { ok: false, message: "Add a reason — the customer sees it" };
    const res = await db.cashout.updateMany({
      where: { id, shop: session.shop, status: "REQUESTED" },
      data: { status: "CANCELLED", cancelReason: reason, handledBy: actor },
    });
    return res.count
      ? { ok: true, message: "Cancelled — returned to the customer's balance" }
      : { ok: false, message: "Already handled" };
  }
  return { ok: false, message: "Unknown action" };
};

type Row = Awaited<ReturnType<typeof loader>>["rows"][number];

function downloadCsv(rows: Row[], status: string) {
  const header = ["Requested", "Customer", "Email", "Amount", "Status", "Sent", "Amazon order", "Cancel reason"];
  const lines = rows.map((r) =>
    [r.requestedAt, r.customer, r.email, r.amount, status, r.sentAt ?? "", r.amazonOrderRef ?? "", r.cancelReason ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cashouts-${status.toLowerCase()}.csv`;
  a.click();
}

export default function Cashouts() {
  const { status, rows, totals, counts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [, setParams] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
      if (fetcher.data.ok) setOpen(null);
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Cash-outs">
      <s-button slot="secondary-actions" onClick={() => downloadCsv(rows, status)}>
        Export CSV
      </s-button>

      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <Stat label={`Waiting to send (${counts.REQUESTED ?? 0})`} value={formatMoney(totals.waiting)} />
          <Stat label="Sent this month" value={formatMoney(totals.sentThisMonth)} />
          <Stat label="Customers can still cash out" value={formatMoney(totals.owedAvailable)} />
          <Stat label="On hold (not yet available)" value={formatMoney(totals.owedPending)} />
        </s-grid>
      </s-section>

      <s-section heading="How to send one">
        <s-paragraph>
          On amazon.com go to Gift Cards → eGift Cards, buy one for the amount with the customer&apos;s
          email as the recipient — Amazon emails it to them. Then click{" "}
          <s-text type="strong">Mark as sent</s-text> here (paste the Amazon order number if you like).
        </s-paragraph>
      </s-section>

      <s-section padding="none">
        <s-box padding="base">
          <s-stack direction="inline" gap="small-200">
            {TABS.map((t) => (
              <s-button
                key={t.status}
                variant={status === t.status ? "primary" : "secondary"}
                onClick={() => setParams({ status: t.status })}
              >
                {t.label} ({counts[t.status] ?? 0})
              </s-button>
            ))}
          </s-stack>
        </s-box>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Customer</s-table-header>
            <s-table-header>Send to</s-table-header>
            <s-table-header format="currency">Amount</s-table-header>
            <s-table-header>Requested</s-table-header>
            <s-table-header>{status === "REQUESTED" ? "Actions" : "Details"}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>{r.customer}</s-table-cell>
                <s-table-cell>{r.email}</s-table-cell>
                <s-table-cell>{formatMoney(r.amount)}</s-table-cell>
                <s-table-cell>{new Date(r.requestedAt).toLocaleString()}</s-table-cell>
                <s-table-cell>
                  {status === "REQUESTED" ? (
                    open === r.id ? (
                      <fetcher.Form method="post">
                        <input type="hidden" name="id" value={r.id} />
                        <s-stack gap="small-200">
                          <s-text-field name="amazonOrderRef" label="Amazon order # (optional)" />
                          <s-text-field name="reason" label="Cancel reason (only if cancelling)" />
                          <s-stack direction="inline" gap="small-200">
                            <s-button type="submit" variant="primary" onClick={() => setIntent("sent")}>
                              Mark as sent
                            </s-button>
                            <s-button type="submit" tone="critical" onClick={() => setIntent("cancel")}>
                              Cancel request
                            </s-button>
                            <s-button variant="tertiary" onClick={() => setOpen(null)}>
                              Close
                            </s-button>
                          </s-stack>
                          <input type="hidden" name="intent" id={`intent-${r.id}`} defaultValue="sent" />
                        </s-stack>
                      </fetcher.Form>
                    ) : (
                      <s-button onClick={() => setOpen(r.id)}>Handle</s-button>
                    )
                  ) : (
                    <s-text color="subdued">
                      {status === "SENT"
                        ? `Sent ${r.sentAt ? new Date(r.sentAt).toLocaleDateString() : ""}${r.amazonOrderRef ? ` · ${r.amazonOrderRef}` : ""}`
                        : r.cancelReason}
                    </s-text>
                  )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {rows.length === 0 && (
          <s-box padding="base">
            <s-text color="subdued">Nothing here.</s-text>
          </s-box>
        )}
      </s-section>
    </s-page>
  );

  function setIntent(intent: "sent" | "cancel") {
    const input = document.getElementById(`intent-${open}`) as HTMLInputElement | null;
    if (input) input.value = intent;
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
