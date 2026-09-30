import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { signState } from "../lib/crypto.server";
import { authorizationUrl, ensureFolder, GoogleNotConnected, listSharedDrives } from "../lib/google.server";
import { rewardSettings } from "../lib/rewards.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [conn, settings] = await Promise.all([
    db.googleConnection.findUnique({ where: { shop: session.shop } }),
    rewardSettings(session.shop),
  ]);
  let drives: { id: string; name: string }[] = [];
  let driveError: string | null = null;
  if (conn) {
    try {
      drives = await listSharedDrives(session.shop);
    } catch (e) {
      driveError = e instanceof GoogleNotConnected ? "The Google connection expired — reconnect." : String(e);
    }
  }
  return {
    google: conn ? { email: conn.email, driveId: conn.sharedDriveId, driveName: conn.sharedDriveName } : null,
    drives,
    driveError,
    settings: {
      perOrderCap: String(settings.perOrderCap),
      eligibleDays: settings.eligibleDays,
      holdDays: settings.holdDays,
      minCashout: String(settings.minCashout),
      referralFriendAmount: String(settings.referralFriendAmount),
      referralReward: String(settings.referralReward),
      referralMinOrder: String(settings.referralMinOrder),
      referralWaitDays: settings.referralWaitDays,
      referralCodeDays: settings.referralCodeDays,
      referralCollectionTitle: settings.referralCollectionTitle,
      agreementText: settings.agreementText,
      agreementVersion: settings.agreementVersion,
      portalEnabled: settings.portalEnabled,
      testerEmails: settings.testerEmails.join("\n"),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "connect") {
    return { ok: true, authUrl: authorizationUrl(signState({ shop })) };
  }

  if (intent === "select-drive") {
    const driveId = String(form.get("driveId") ?? "");
    const drives = await listSharedDrives(shop);
    const picked = drives.find((d) => d.id === driveId);
    if (!picked) return { ok: false, message: "Pick a Shared Drive" };
    const approvedFolderId = await ensureFolder(shop, picked.id, picked.id, "Approved");
    await db.googleConnection.update({
      where: { shop },
      data: { sharedDriveId: picked.id, sharedDriveName: picked.name, approvedFolderId },
    });
    return { ok: true, message: `Uploads will go to "${picked.name}"` };
  }

  if (intent === "disconnect") {
    await db.googleConnection.deleteMany({ where: { shop } });
    return { ok: true, message: "Google Drive disconnected" };
  }

  if (intent === "referral-collection") {
    const id = String(form.get("collectionId") ?? "");
    const title = String(form.get("collectionTitle") ?? "");
    await db.rewardSettings.update({
      where: { shop },
      data: { referralCollectionId: id || null, referralCollectionTitle: id ? title : null },
    });
    return {
      ok: true,
      message: id ? `Referral codes now apply to "${title}"` : "Referral codes now use the minimum order instead",
    };
  }

  if (intent === "settings") {
    const current = await rewardSettings(shop);
    const perOrderCap = Number(form.get("perOrderCap"));
    const eligibleDays = Number(form.get("eligibleDays"));
    const holdDays = Number(form.get("holdDays"));
    const minCashout = Number(form.get("minCashout"));
    const referral = {
      referralFriendAmount: Number(form.get("referralFriendAmount")),
      referralReward: Number(form.get("referralReward")),
      referralMinOrder: Number(form.get("referralMinOrder")),
      referralWaitDays: Number(form.get("referralWaitDays")),
      referralCodeDays: Number(form.get("referralCodeDays")),
    };
    if (
      !(referral.referralFriendAmount > 0) ||
      !(referral.referralReward > 0) ||
      !(referral.referralMinOrder >= 0) ||
      !(referral.referralWaitDays >= 0) ||
      !(referral.referralCodeDays >= 1)
    ) {
      return { ok: false, message: "Check the referral values" };
    }
    const agreementText = String(form.get("agreementText") ?? "").trim();
    if (!(perOrderCap > 0) || !(eligibleDays >= 0) || !(holdDays >= 0) || !(minCashout >= 1) || !agreementText) {
      return { ok: false, message: "Check the values — all fields are required" };
    }
    const portalEnabled = form.get("portalEnabled") === "on";
    const testerEmails = String(form.get("testerEmails") ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"));
    const agreementChanged = agreementText !== current.agreementText;
    await db.rewardSettings.update({
      where: { shop },
      data: {
        perOrderCap: perOrderCap.toFixed(2),
        eligibleDays,
        holdDays,
        minCashout: minCashout.toFixed(2),
        referralFriendAmount: referral.referralFriendAmount.toFixed(2),
        referralReward: referral.referralReward.toFixed(2),
        referralMinOrder: referral.referralMinOrder.toFixed(2),
        referralWaitDays: referral.referralWaitDays,
        referralCodeDays: referral.referralCodeDays,
        agreementText,
        portalEnabled,
        testerEmails,
        ...(agreementChanged ? { agreementVersion: current.agreementVersion + 1 } : {}),
      },
    });
    return {
      ok: true,
      message: agreementChanged ? "Saved — new agreement version applies to new submissions" : "Saved",
    };
  }
  return { ok: false, message: "Unknown action" };
};

export default function RewardsSettings() {
  const { google, drives, driveError, settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [params] = useSearchParams();
  const busy = fetcher.state !== "idle";

  const pickReferralCollection = async () => {
    const picked = await shopify.resourcePicker({ type: "collection", multiple: false });
    const c = picked?.[0];
    if (!c) return;
    fetcher.submit(
      { intent: "referral-collection", collectionId: c.id, collectionTitle: (c as { title?: string }).title ?? "" },
      { method: "POST" },
    );
  };

  useEffect(() => {
    const data = fetcher.data as { ok: boolean; message?: string; authUrl?: string } | undefined;
    if (data?.authUrl) window.open(data.authUrl, "_top");
    else if (data?.message) shopify.toast.show(data.message, { isError: !data.ok });
  }, [fetcher.data, shopify]);

  useEffect(() => {
    const result = params.get("google");
    if (result === "connected") shopify.toast.show("Google Drive connected");
    else if (result) shopify.toast.show(`Google connection failed (${result})`, { isError: true });
  }, [params, shopify]);

  return (
    <s-page heading="Rewards settings">
      <s-link slot="breadcrumb-actions" href="/app/submissions">Review queue</s-link>

      <s-section heading="Google Drive">
        {google ? (
          <s-stack gap="base">
            <s-paragraph>
              Connected as <s-text type="strong">{google.email}</s-text>.{" "}
              {google.driveName ? (
                <>Uploads go to the Shared Drive <s-text type="strong">{google.driveName}</s-text>.</>
              ) : (
                <>Pick the Shared Drive uploads should go to.</>
              )}
            </s-paragraph>
            {driveError && <s-banner tone="critical">{driveError}</s-banner>}
            {drives.length > 0 && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="select-drive" />
                <s-stack direction="inline" gap="base" alignItems="end">
                  <s-select name="driveId" label="Shared Drive" value={google.driveId ?? ""}>
                    <s-option value="">Choose…</s-option>
                    {drives.map((d) => (
                      <s-option key={d.id} value={d.id}>
                        {d.name}
                      </s-option>
                    ))}
                  </s-select>
                  <s-button type="submit" {...(busy ? { loading: true } : {})}>
                    Use this drive
                  </s-button>
                </s-stack>
              </fetcher.Form>
            )}
            {!driveError && drives.length === 0 && (
              <s-banner tone="warning">
                This Google account can&apos;t see any Shared Drives. Add it to the &quot;Customer
                Reviews&quot; Shared Drive as a Manager or Content manager, then reload.
              </s-banner>
            )}
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => fetcher.submit({ intent: "connect" }, { method: "POST" })}>
                Reconnect
              </s-button>
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() => fetcher.submit({ intent: "disconnect" }, { method: "POST" })}
              >
                Disconnect
              </s-button>
            </s-stack>
          </s-stack>
        ) : (
          <s-stack gap="base">
            <s-paragraph>
              Customer uploads go straight into a Google Shared Drive. Connect with a company Google
              account that&apos;s a Manager or Content manager on the &quot;Customer Reviews&quot; Shared
              Drive — a shared mailbox is best, so it doesn&apos;t depend on one person.
            </s-paragraph>
            <s-button
              variant="primary"
              onClick={() => fetcher.submit({ intent: "connect" }, { method: "POST" })}
              {...(busy ? { loading: true } : {})}
            >
              Connect Google Drive
            </s-button>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Rules">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="settings" />
          <s-stack gap="base">
            <s-checkbox
              name="portalEnabled"
              label="Portal is live for all customers"
              details="While off, only the tester emails below can use a-diy.com/apps/rewards; everyone else sees “coming soon”."
              defaultChecked={settings.portalEnabled}
            />
            <s-text-area
              name="testerEmails"
              label="Tester emails (one per line)"
              defaultValue={settings.testerEmails}
              rows={3}
            />
            <s-stack direction="inline" gap="base">
              <s-number-field
                name="perOrderCap"
                label="Most one order can earn ($)"
                defaultValue={settings.perOrderCap}
                min={1}
                step={1}
              />
              <s-number-field
                name="eligibleDays"
                label="Days after fulfillment an undelivered order counts as delivered"
                defaultValue={String(settings.eligibleDays)}
                min={0}
                step={1}
              />
              <s-number-field
                name="minCashout"
                label="Minimum cash-out ($)"
                defaultValue={settings.minCashout}
                min={1}
                step={1}
              />
              <s-number-field
                name="holdDays"
                label="Days an approved reward stays pending"
                defaultValue={String(settings.holdDays)}
                min={0}
                step={1}
              />
            </s-stack>
            <s-heading>Referrals</s-heading>
            <s-stack direction="inline" gap="base">
              <s-number-field name="referralFriendAmount" label="Friend's discount ($)" defaultValue={settings.referralFriendAmount} min={1} step={1} />
              <s-number-field name="referralReward" label="Referrer's reward ($)" defaultValue={settings.referralReward} min={1} step={1} />
              <s-number-field name="referralMinOrder" label="Friend's minimum order ($)" defaultValue={settings.referralMinOrder} min={0} step={1} />
              <s-number-field name="referralWaitDays" label="Days after delivery before paying the referrer" defaultValue={String(settings.referralWaitDays)} min={0} step={1} />
              <s-number-field name="referralCodeDays" label="Friend's code expires after (days)" defaultValue={String(settings.referralCodeDays)} min={1} step={1} />
            </s-stack>
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text>
                Friend&apos;s discount applies to:{" "}
                <s-text type="strong">
                  {settings.referralCollectionTitle
                    ? `products in "${settings.referralCollectionTitle}"`
                    : "any order over the minimum (doesn't work on payment plans)"}
                </s-text>
              </s-text>
              <s-button onClick={pickReferralCollection}>Choose deck-kit collection</s-button>
              {settings.referralCollectionTitle && (
                <s-button
                  variant="tertiary"
                  onClick={() => fetcher.submit({ intent: "referral-collection", collectionId: "" }, { method: "POST" })}
                >
                  Clear
                </s-button>
              )}
            </s-stack>
            <s-paragraph color="subdued">
              Choosing a collection of your deck kits is recommended: payment-plan checkouts only show the
              first payment, so a minimum order amount would block them. Changes apply to codes issued from now on.
            </s-paragraph>
            <s-text-area
              name="agreementText"
              label={`Content-use agreement (version ${settings.agreementVersion}) — needs legal sign-off`}
              defaultValue={settings.agreementText}
              rows={6}
            />
            <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
              Save
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
