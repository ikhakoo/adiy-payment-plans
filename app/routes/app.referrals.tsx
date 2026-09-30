import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { ReferralStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { approveReferral } from "../lib/referrals.server";

const TABS: { status: ReferralStatus; label: string }[] = [
  { status: "FLAGGED", label: "Needs review" },
  { status: "ORDERED", label: "Ordered — waiting" },
  { status: "ISSUED", label: "Code sent" },
  { status: "QUALIFIED", label: "Paid out" },
  { status: "REJECTED", label: "Rejected" },
  { status: "EXPIRED", label: "Expired" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const status = (new URL(request.url).searchParams.get("status") as ReferralStatus) || "FLAGGED";
  const [rows, counts] = await Promise.all([
    db.referral.findMany({
      where: { shop, status },
      include: { referrerCode: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    db.referral.groupBy({ by: ["status"], where: { shop }, _count: true }),
  ]);
  return {
    status,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>,
    rows: rows.map((r) => ({
      id: r.id,
      referrer: r.referrerCode.customerName ?? r.referrerCode.customerEmail ?? "Customer",
      referrerCode: r.referrerCode.code,
      friendEmail: r.friendEmail,
      discountCode: r.discountCode,
      orderName: r.orderName,
      orderId: r.orderId?.split("/").pop() ?? null,
      qualifiesAt: r.qualifiesAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      reason: r.flagReason ?? r.rejectReason,
      createdAt: r.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const actor = sessionToken?.sub ? `staff:${sessionToken.sub}` : "staff";
  const form = await request.formData();
  const referral = await db.referral.findFirst({
    where: { id: String(form.get("id") ?? ""), shop: session.shop, status: "FLAGGED" },
  });
  if (!referral) return { ok: false, message: "Already handled" };

  if (form.get("intent") === "approve") {
    await approveReferral(referral, actor);
    return { ok: true, message: "Approved — the referrer has been credited" };
  }
  if (form.get("intent") === "reject") {
    await db.referral.update({
      where: { id: referral.id },
      data: { status: "REJECTED", rejectReason: `Rejected by staff: ${referral.flagReason ?? ""}`.trim(), handledBy: actor },
    });
    return { ok: true, message: "Rejected" };
  }
  return { ok: false, message: "Unknown action" };
};

export default function Referrals() {
  const { status, rows, counts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [, setParams] = useSearchParams();

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

  return (
    <s-page heading="Referrals">
      <s-section heading="How it works">
        <s-paragraph>
          A customer shares their link; a first-time customer enters their email and gets a one-time
          code tied to that email. When their order has been delivered for the wait period (and is paid
          in full — payment plans included), the referrer is credited automatically. Anything that looks
          like a self-referral lands in <s-text type="strong">Needs review</s-text>.
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
            <s-table-header listSlot="primary">Referrer</s-table-header>
            <s-table-header>Friend</s-table-header>
            <s-table-header>Order</s-table-header>
            <s-table-header>{status === "ISSUED" ? "Code expires" : "Qualifies"}</s-table-header>
            <s-table-header>{status === "FLAGGED" ? "Why flagged" : "Note"}</s-table-header>
            {status === "FLAGGED" && <s-table-header>Decision</s-table-header>}
          </s-table-header-row>
          <s-table-body>
            {rows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>
                  {r.referrer} <s-text color="subdued">({r.referrerCode})</s-text>
                </s-table-cell>
                <s-table-cell>
                  {r.friendEmail} <s-text color="subdued">{r.discountCode}</s-text>
                </s-table-cell>
                <s-table-cell>
                  {r.orderId ? (
                    <s-link href={`shopify://admin/orders/${r.orderId}`} target="_blank">
                      {r.orderName}
                    </s-link>
                  ) : (
                    "—"
                  )}
                </s-table-cell>
                <s-table-cell>{status === "ISSUED" ? date(r.expiresAt) : date(r.qualifiesAt)}</s-table-cell>
                <s-table-cell>{r.reason ?? ""}</s-table-cell>
                {status === "FLAGGED" && (
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button
                        variant="primary"
                        onClick={() => fetcher.submit({ intent: "approve", id: r.id }, { method: "POST" })}
                      >
                        Approve
                      </s-button>
                      <s-button
                        tone="critical"
                        onClick={() => fetcher.submit({ intent: "reject", id: r.id }, { method: "POST" })}
                      >
                        Reject
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                )}
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
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
