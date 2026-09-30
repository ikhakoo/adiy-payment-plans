import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureFolder, moveItem } from "../lib/google.server";
import { approvalHeadroom, logSubmission } from "../lib/rewards.server";
import { formatMoney } from "../lib/format";
import { submissionLabel, submissionTone } from "./app.submissions._index";

async function load(shop: string, id: string) {
  const s = await db.submission.findFirst({
    where: { id, shop },
    include: {
      rewardType: true,
      files: { where: { status: "UPLOADED" }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!s) throw new Response("Not found", { status: 404 });
  return s;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const s = await load(session.shop, params.id!);
  const headroom = await approvalHeadroom(s);
  const min = Number(s.rewardType.minAmount);
  const max = Math.min(Number(s.rewardType.maxAmount), headroom);
  return {
    s: {
      id: s.id,
      status: s.status,
      customer: s.customerName ?? "Customer",
      email: s.customerEmail,
      orderId: s.orderId.split("/").pop(),
      orderName: s.orderName,
      reward: s.rewardType.name,
      rewardDescription: s.rewardType.description,
      note: s.note,
      amount: s.amount ? String(s.amount) : null,
      reviewMessage: s.reviewMessage,
      folderId: s.driveFolderId,
      agreementVersion: s.agreementVersion,
      agreedAt: s.agreedAt?.toISOString() ?? null,
    },
    approve: { min, max, suggested: Math.min(Number(s.rewardType.maxAmount), max), capped: max < min },
    files: s.files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: Number(f.size),
      driveFileId: f.driveFileId,
    })),
    events: s.events.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor,
      message: e.message,
      at: e.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const shop = session.shop;
  const s = await load(shop, params.id!);
  const actor = sessionToken?.sub ? `staff:${sessionToken.sub}` : "staff";
  const form = await request.formData();
  const intent = form.get("intent");
  const message = String(form.get("message") ?? "").trim();

  if (!["PENDING", "NEEDS_CHANGES"].includes(s.status)) {
    return { ok: false, message: `Already ${submissionLabel(s.status).toLowerCase()}` };
  }

  if (intent === "approve") {
    const amount = Number(form.get("amount"));
    const headroom = await approvalHeadroom(s);
    const min = Number(s.rewardType.minAmount);
    const max = Math.min(Number(s.rewardType.maxAmount), headroom);
    if (!(amount >= min && amount <= max)) {
      return {
        ok: false,
        message:
          max < min
            ? "This order has reached its reward limit — reject it or raise the limit in settings"
            : `Amount has to be between ${formatMoney(min)} and ${formatMoney(max)}`,
      };
    }
    await db.submission.update({
      where: { id: s.id },
      data: {
        status: "APPROVED",
        amount: amount.toFixed(2),
        reviewedBy: actor,
        reviewedAt: new Date(),
        reviewMessage: message || null,
      },
    });
    await logSubmission(s.id, "approved", `${formatMoney(amount)}${message ? ` — ${message}` : ""}`, actor);

    // Move the files into Approved/ for the marketing team; approval stands even if this fails.
    const conn = await db.googleConnection.findUnique({ where: { shop } });
    if (conn?.sharedDriveId && conn.approvedFolderId && s.driveFolderId) {
      try {
        const orderFolder = await ensureFolder(
          shop,
          conn.sharedDriveId,
          conn.approvedFolderId,
          `${s.orderName} – ${s.customerName ?? "Customer"}`.replace(/[\\/:*?"<>|]/g, "-"),
        );
        await moveItem(shop, s.driveFolderId, orderFolder);
      } catch (e) {
        await logSubmission(s.id, "drive_move_failed", String(e), "system");
      }
    }
    return { ok: true, message: `Approved — ${formatMoney(amount)}` };
  }

  if (intent === "needs-changes" || intent === "reject") {
    if (!message) return { ok: false, message: "Add a message for the customer" };
    const status = intent === "reject" ? "REJECTED" : "NEEDS_CHANGES";
    await db.submission.update({
      where: { id: s.id },
      data: { status, reviewMessage: message, reviewedBy: actor, reviewedAt: new Date() },
    });
    await logSubmission(s.id, intent === "reject" ? "rejected" : "needs_changes", message, actor);
    return { ok: true, message: intent === "reject" ? "Rejected" : "Sent back to the customer" };
  }
  return { ok: false, message: "Unknown action" };
};

const sizeLabel = (bytes: number) =>
  bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

export default function SubmissionDetail() {
  const { s, approve, files, events } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const open = s.status === "PENDING" || s.status === "NEEDS_CHANGES";
  const decline = (intent: "needs-changes" | "reject") => {
    const data = new FormData(document.getElementById("decline-form") as HTMLFormElement);
    data.set("intent", intent);
    fetcher.submit(data, { method: "POST" });
  };

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  return (
    <s-page heading={`${s.customer} · ${s.reward}`}>
      <s-link slot="breadcrumb-actions" href="/app/submissions">Review queue</s-link>
      {s.folderId && (
        <s-button slot="secondary-actions" href={`https://drive.google.com/drive/folders/${s.folderId}`} target="_blank">
          Open in Google Drive
        </s-button>
      )}
      <s-button slot="secondary-actions" href={`shopify://admin/orders/${s.orderId}`} target="_blank">
        Open order {s.orderName}
      </s-button>

      <s-section heading="Submission">
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200">
            <s-badge tone={submissionTone(s.status)}>{submissionLabel(s.status)}</s-badge>
            {s.amount && <s-badge tone="success">{formatMoney(s.amount)}</s-badge>}
          </s-stack>
          <s-paragraph>
            <s-text type="strong">Looking for:</s-text> {s.rewardDescription}
          </s-paragraph>
          {s.note && (
            <s-paragraph>
              <s-text type="strong">Customer note:</s-text> {s.note}
            </s-paragraph>
          )}
          {s.reviewMessage && (
            <s-paragraph>
              <s-text type="strong">Message to customer:</s-text> {s.reviewMessage}
            </s-paragraph>
          )}
          <s-text color="subdued">
            {s.email} · agreed to content agreement v{s.agreementVersion}
            {s.agreedAt ? ` on ${new Date(s.agreedAt).toLocaleString()}` : ""}
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading={`Files (${files.length})`}>
        <s-paragraph color="subdued">
          Previews need you to be signed in to Google with access to the Shared Drive. New videos can
          take a few minutes to become playable.
        </s-paragraph>
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap="base">
          {files.map((f) => (
            <s-box key={f.id} borderWidth="base" borderRadius="base" padding="small-200">
              {f.driveFileId && (
                <iframe
                  title={f.name}
                  src={`https://drive.google.com/file/d/${f.driveFileId}/preview`}
                  style={{ width: "100%", height: 220, border: 0 }}
                  allow="autoplay"
                />
              )}
              <s-stack direction="inline" gap="small-200">
                <s-text>{f.name}</s-text>
                <s-text color="subdued">{sizeLabel(f.size)}</s-text>
                {f.driveFileId && (
                  <s-link href={`https://drive.google.com/file/d/${f.driveFileId}/view`} target="_blank">
                    Open
                  </s-link>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      {open && (
        <s-section heading="Decision">
          <s-stack gap="base">
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="approve" />
              <s-stack direction="inline" gap="base" alignItems="end">
                <s-number-field
                  name="amount"
                  label={
                    approve.min === approve.max
                      ? "Reward ($)"
                      : `Reward ($${approve.min}–$${approve.max})`
                  }
                  defaultValue={String(approve.suggested)}
                  min={approve.min}
                  max={approve.max}
                  step={1}
                  disabled={approve.capped}
                />
                <s-text-field name="message" label="Note to customer (optional)" />
                <s-button type="submit" variant="primary" disabled={approve.capped}>
                  Approve
                </s-button>
              </s-stack>
              {approve.capped && (
                <s-text tone="critical">This order has already earned its maximum reward.</s-text>
              )}
            </fetcher.Form>
            <form id="decline-form" onSubmit={(e) => e.preventDefault()}>
              <s-stack direction="inline" gap="base" alignItems="end">
                <s-text-field
                  name="message"
                  label="Message to customer (required to ask for changes or reject)"
                  placeholder="e.g. The video is too dark — could you film it in daylight?"
                />
                <s-button onClick={() => decline("needs-changes")}>Ask for changes</s-button>
                <s-button tone="critical" onClick={() => decline("reject")}>
                  Reject
                </s-button>
              </s-stack>
            </form>
          </s-stack>
        </s-section>
      )}

      <s-section heading="History">
        <s-stack gap="small-200">
          {events.map((e) => (
            <s-text key={e.id} color="subdued">
              {new Date(e.at).toLocaleString()} · {e.actor} · {e.type.replaceAll("_", " ")}
              {e.message ? ` — ${e.message}` : ""}
            </s-text>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
