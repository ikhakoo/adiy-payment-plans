import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { RewardMedia } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { rewardTypes } from "../lib/rewards.server";
import { formatMoney } from "../lib/format";

const MEDIA: Record<RewardMedia, string> = { VIDEO: "Video", PHOTO: "Photos", ANY: "Video or photos" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const types = await rewardTypes(session.shop);
  return {
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      media: t.media,
      minAmount: String(t.minAmount),
      maxAmount: String(t.maxAmount),
      perOrderLimit: t.perOrderLimit,
      active: t.active,
      position: t.position,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");

  if (intent === "toggle") {
    const type = await db.rewardType.findFirst({ where: { id, shop } });
    if (!type) return { ok: false, message: "Not found" };
    await db.rewardType.update({ where: { id }, data: { active: !type.active } });
    return { ok: true, message: type.active ? `"${type.name}" turned off` : `"${type.name}" turned on` };
  }

  if (intent === "save") {
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const media = String(form.get("media")) as RewardMedia;
    const minAmount = Number(form.get("minAmount"));
    const maxAmount = Number(form.get("maxAmount") || form.get("minAmount"));
    const perOrderLimit = Number(form.get("perOrderLimit") || 1);
    const position = Number(form.get("position") || 0);
    if (!name || !description) return { ok: false, message: "Name and description are required" };
    if (!(minAmount > 0) || !(maxAmount >= minAmount)) {
      return { ok: false, message: "Amounts must be above 0, and the maximum can't be below the minimum" };
    }
    if (!["VIDEO", "PHOTO", "ANY"].includes(media) || !(perOrderLimit >= 1)) {
      return { ok: false, message: "Check the media type and limit" };
    }
    const data = {
      name,
      description,
      media,
      minAmount: minAmount.toFixed(2),
      maxAmount: maxAmount.toFixed(2),
      perOrderLimit,
      position,
    };
    if (id) {
      const updated = await db.rewardType.updateMany({ where: { id, shop }, data });
      if (!updated.count) return { ok: false, message: "Not found" };
    } else {
      await db.rewardType.create({ data: { ...data, shop } });
    }
    return { ok: true, message: `"${name}" saved`, saved: true };
  }
  return { ok: false, message: "Unknown action" };
};

type TypeRow = Awaited<ReturnType<typeof loader>>["types"][number];

export default function RewardTypes() {
  const { types } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [editing, setEditing] = useState<string | null>(null); // type id, "new" or null

  useEffect(() => {
    const data = fetcher.data as { ok: boolean; message: string; saved?: boolean } | undefined;
    if (!data) return;
    shopify.toast.show(data.message, { isError: !data.ok });
    if (data.saved) setEditing(null);
  }, [fetcher.data, shopify]);

  const amount = (t: TypeRow) =>
    t.minAmount === t.maxAmount
      ? formatMoney(t.minAmount)
      : `${formatMoney(t.minAmount)}–${formatMoney(t.maxAmount)}`;

  return (
    <s-page heading="Reward types">
      <s-button slot="primary-action" onClick={() => setEditing("new")}>
        Add reward type
      </s-button>

      {editing === "new" && (
        <s-section heading="New reward type">
          <TypeForm fetcher={fetcher} onCancel={() => setEditing(null)} nextPosition={types.length} />
        </s-section>
      )}

      <s-section heading="What customers can submit" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Reward</s-table-header>
            <s-table-header>Accepts</s-table-header>
            <s-table-header format="currency">Amount</s-table-header>
            <s-table-header>Per order</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {types.map((t) => (
              <s-table-row key={t.id}>
                <s-table-cell>
                  <s-text type="strong">{t.name}</s-text>
                  <s-paragraph color="subdued">{t.description}</s-paragraph>
                </s-table-cell>
                <s-table-cell>{MEDIA[t.media]}</s-table-cell>
                <s-table-cell>{amount(t)}</s-table-cell>
                <s-table-cell>{t.perOrderLimit}×</s-table-cell>
                <s-table-cell>
                  <s-badge tone={t.active ? "success" : "neutral"}>{t.active ? "On" : "Off"}</s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-stack direction="inline" gap="small-200">
                    <s-button variant="tertiary" onClick={() => setEditing(t.id)}>
                      Edit
                    </s-button>
                    <s-button
                      variant="tertiary"
                      onClick={() => fetcher.submit({ intent: "toggle", id: t.id }, { method: "POST" })}
                    >
                      {t.active ? "Turn off" : "Turn on"}
                    </s-button>
                  </s-stack>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {types
        .filter((t) => t.id === editing)
        .map((t) => (
          <s-section key={t.id} heading={`Edit "${t.name}"`}>
            <TypeForm fetcher={fetcher} type={t} onCancel={() => setEditing(null)} nextPosition={t.position} />
          </s-section>
        ))}
    </s-page>
  );
}

function TypeForm({
  fetcher,
  type,
  onCancel,
  nextPosition,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  type?: TypeRow;
  onCancel: () => void;
  nextPosition: number;
}) {
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="save" />
      {type && <input type="hidden" name="id" value={type.id} />}
      <s-stack gap="base">
        <s-text-field name="name" label="Name" defaultValue={type?.name ?? ""} required />
        <s-text-area
          name="description"
          label="What we're looking for (shown to customers)"
          defaultValue={type?.description ?? ""}
          rows={3}
        />
        <s-stack direction="inline" gap="base">
          <s-select name="media" label="Accepts" value={type?.media ?? "ANY"}>
            <s-option value="VIDEO">Video</s-option>
            <s-option value="PHOTO">Photos</s-option>
            <s-option value="ANY">Video or photos</s-option>
          </s-select>
          <s-number-field name="minAmount" label="Amount ($)" defaultValue={type?.minAmount ?? ""} min={1} step={1} />
          <s-number-field
            name="maxAmount"
            label="Up to ($) — leave blank for a fixed amount"
            defaultValue={type && type.maxAmount !== type.minAmount ? type.maxAmount : ""}
            min={1}
            step={1}
          />
          <s-number-field
            name="perOrderLimit"
            label="Times per order"
            defaultValue={String(type?.perOrderLimit ?? 1)}
            min={1}
            step={1}
          />
          <s-number-field
            name="position"
            label="Order in list"
            defaultValue={String(type?.position ?? nextPosition)}
            step={1}
          />
        </s-stack>
        <s-stack direction="inline" gap="base">
          <s-button type="submit" variant="primary">
            Save
          </s-button>
          <s-button variant="tertiary" onClick={onCancel}>
            Cancel
          </s-button>
        </s-stack>
      </s-stack>
    </fetcher.Form>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
