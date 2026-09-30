// Customer-facing rewards portal, served through the Shopify App Proxy at /apps/rewards.
// Shopify signs every proxied request and appends `logged_in_customer_id` when a customer is
// signed in; authenticate.public.appProxy verifies that signature.
import { authenticate } from "../shopify.server";
import type { AdminGraphql } from "./shopify-ops.server";

export const PORTAL_PATH = "/apps/rewards";

export async function portalContext(request: Request) {
  const { admin, session, liquid } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const loggedIn = url.searchParams.get("logged_in_customer_id");
  return {
    admin: admin as AdminGraphql | undefined,
    shop: session?.shop ?? url.searchParams.get("shop") ?? "",
    customerId: loggedIn ? `gid://shopify/Customer/${loggedIn}` : null,
    liquid,
  };
}

/**
 * HTML-escapes text and also neutralises Liquid delimiters: portal pages are returned as
 * Liquid, so customer-supplied text like "{{ shop.email }}" must never be evaluated.
 */
export function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

export const money = (amount: number | string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(amount));

const moneyRange = (min: number | string, max: number | string) =>
  Number(min) === Number(max) ? money(min) : `${money(min)}–${money(max)}`;
export { moneyRange };

/** Page body wrapped in the portal's styles; rendered inside the theme layout by Shopify. */
export function portalPage(body: string) {
  return `
<style>
  .rw { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; color: #1a1a1a; }
  .rw h1 { margin: 0 0 6px; }
  .rw h2 { margin: 0 0 4px; font-size: 20px; }
  .rw p { margin: 0 0 12px; line-height: 1.5; }
  .rw .muted { color: #5c5c5c; font-size: 14px; }
  .rw .step { background: #1b3d2f; color: #fff; padding: 6px 16px; border-radius: 10px 10px 0 0; font-size: 14px; }
  .rw .card { border: 1px solid #e2e2e2; border-radius: 6px; background: #fff; margin-bottom: 24px; overflow: hidden; }
  .rw .card-body { padding: 16px; }
  .rw .order { display: flex; gap: 14px; align-items: center; }
  .rw .order img { width: 72px; height: 72px; object-fit: cover; border-radius: 4px; background: #f3f3f3; }
  .rw .rewards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 16px; }
  .rw .reward { border: 1px solid #e2e2e2; border-radius: 3px; padding: 14px; display: flex; flex-direction: column; gap: 6px; }
  .rw .reward .amount { font-size: 20px; font-weight: 600; color: #1b3d2f; }
  .rw .btn { display: inline-block; text-align: center; background: #1b3d2f; color: #fff; border: 0; border-radius: 4px;
             padding: 10px 16px; font: inherit; font-size: 15px; cursor: pointer; text-decoration: none; }
  .rw .btn[disabled], .rw .btn.disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }
  .rw .btn.secondary { background: #fff; color: #1b3d2f; border: 1px solid #1b3d2f; }
  .rw .badge { display: inline-block; font-size: 13px; padding: 2px 10px; border-radius: 99px; background: #ecebeb; }
  .rw .badge.ok { background: #dff2e6; color: #13502a; }
  .rw .badge.warn { background: #fff1d6; color: #6b4a00; }
  .rw .badge.bad { background: #fde2e1; color: #7a1a14; }
  .rw .notice { background: #f5f4f0; border-left: 3px solid #1b3d2f; padding: 10px 14px; margin: 12px 0; font-size: 14px; }
  .rw .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0 28px; }
  .rw .stat { border: 1px solid #e2e2e2; border-radius: 6px; padding: 14px; }
  .rw .stat b { display: block; font-size: 22px; margin-top: 4px; }
  .rw .files { list-style: none; padding: 0; margin: 12px 0; }
  .rw .files li { border: 1px solid #e2e2e2; border-radius: 4px; padding: 10px 12px; margin-bottom: 8px; font-size: 14px; }
  .rw .bar { height: 6px; background: #ecebeb; border-radius: 3px; margin-top: 8px; overflow: hidden; }
  .rw .bar span { display: block; height: 100%; width: 0; background: #1b3d2f; transition: width .2s; }
  .rw textarea { width: 100%; min-height: 80px; font: inherit; padding: 10px; border: 1px solid #ccc; border-radius: 4px; }
  .rw .agree { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; margin: 16px 0; }
  .rw .drop { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px;
              border: 2px dashed #c9c9c9; border-radius: 6px; padding: 28px 16px; text-align: center; cursor: pointer;
              transition: background-color .15s, border-color .15s; }
  .rw .drop:hover, .rw .drop.over { border-color: #1b3d2f; background: #f5f4f0; }
  .rw .drop input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .rw .drop:has(input:focus-visible) { outline: 2px solid #1b3d2f; outline-offset: 2px; }
  .rw .drop .btn { pointer-events: none; }
</style>
<div class="rw">${body}</div>`;
}

let domainsCache: { shop: string; hosts: string[]; at: number } | null = null;

/** Hosts the storefront is served on — the only origins allowed to upload into Drive. */
export async function storefrontHosts(admin: AdminGraphql, shop: string) {
  if (domainsCache?.shop === shop && Date.now() - domainsCache.at < 10 * 60_000) return domainsCache.hosts;
  const res = await admin.graphql(`#graphql
    query StorefrontHosts { shop { myshopifyDomain primaryDomain { host } } }`);
  const json = (await res.json()) as { data: { shop: { myshopifyDomain: string; primaryDomain: { host: string } } } };
  const primary = json.data.shop.primaryDomain.host;
  const hosts = [json.data.shop.myshopifyDomain, primary, primary.replace(/^www\./, ""), `www.${primary.replace(/^www\./, "")}`];
  domainsCache = { shop, hosts, at: Date.now() };
  return hosts;
}
