import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { SubmissionStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { formatMoney } from "../lib/format";

const TABS: { status: SubmissionStatus; label: string }[] = [
  { status: "PENDING", label: "To review" },
  { status: "NEEDS_CHANGES", label: "Waiting on customer" },
  { status: "APPROVED", label: "Approved" },
  { status: "REJECTED", label: "Rejected" },
];

export const submissionTone = (s: string) =>
  (({ PENDING: "info", NEEDS_CHANGES: "warning", APPROVED: "success", REJECTED: "critical", DRAFT: "neutral" }) as const)[
    s as SubmissionStatus
  ] ?? "neutral";

export const submissionLabel = (s: string) =>
  ({ PENDING: "To review", NEEDS_CHANGES: "Waiting on customer", APPROVED: "Approved", REJECTED: "Rejected", DRAFT: "Draft" })[
    s as SubmissionStatus
  ] ?? s;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const status = (new URL(request.url).searchParams.get("status") as SubmissionStatus) || "PENDING";
  const [rows, counts, conn] = await Promise.all([
    db.submission.findMany({
      where: { shop, status },
      include: { rewardType: true, _count: { select: { files: { where: { status: "UPLOADED" } } } } },
      // Oldest first in the to-review queue; newest first everywhere else.
      orderBy: { submittedAt: status === "PENDING" ? "asc" : "desc" },
      take: 200,
    }),
    db.submission.groupBy({ by: ["status"], where: { shop, status: { not: "DRAFT" } }, _count: true }),
    db.googleConnection.findUnique({ where: { shop } }),
  ]);
  return {
    status,
    driveReady: Boolean(conn?.sharedDriveId),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>,
    rows: rows.map((s) => ({
      id: s.id,
      customer: s.customerName ?? s.customerEmail ?? "Customer",
      orderName: s.orderName,
      reward: s.rewardType.name,
      range:
        String(s.rewardType.minAmount) === String(s.rewardType.maxAmount)
          ? formatMoney(String(s.rewardType.minAmount))
          : `${formatMoney(String(s.rewardType.minAmount))}–${formatMoney(String(s.rewardType.maxAmount))}`,
      amount: s.amount ? String(s.amount) : null,
      files: s._count.files,
      submittedAt: s.submittedAt?.toISOString() ?? null,
    })),
  };
};

export default function ReviewQueue() {
  const { status, rows, counts, driveReady } = useLoaderData<typeof loader>();
  const [, setParams] = useSearchParams();

  return (
    <s-page heading="Review queue">
      <s-button slot="secondary-actions" href="/app/reward-types">
        Reward types
      </s-button>
      <s-button slot="secondary-actions" href="/app/rewards-settings">
        Settings
      </s-button>

      {!driveReady && (
        <s-banner tone="warning" heading="Google Drive isn't set up">
          <s-paragraph>
            Customers can&apos;t upload until Google Drive is connected and a Shared Drive is picked in{" "}
            <s-link href="/app/rewards-settings">Rewards settings</s-link>.
          </s-paragraph>
        </s-banner>
      )}

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
            <s-table-header>Order</s-table-header>
            <s-table-header>Reward</s-table-header>
            <s-table-header>Files</s-table-header>
            <s-table-header>Submitted</s-table-header>
            <s-table-header format="currency">{status === "APPROVED" ? "Approved" : "Worth"}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>
                  <Link to={`/app/submissions/${r.id}`}>{r.customer}</Link>
                </s-table-cell>
                <s-table-cell>{r.orderName}</s-table-cell>
                <s-table-cell>{r.reward}</s-table-cell>
                <s-table-cell>{r.files}</s-table-cell>
                <s-table-cell>{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}</s-table-cell>
                <s-table-cell>{r.amount ? formatMoney(r.amount) : r.range}</s-table-cell>
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
