// Customer hub (orders, rewards, referrals, support), served through the Shopify App Proxy at /apps/hub.
// Shopify signs every proxied request and appends `logged_in_customer_id` when a customer is
// signed in; authenticate.public.appProxy verifies that signature.
import { authenticate } from "../shopify.server";
import type { AdminGraphql } from "./shopify-ops.server";

// Fallback only: stores can customise the proxy prefix/subpath, so links are built from the signed
// `path_prefix` Shopify sends with each request (see portalContext).
export const PORTAL_PATH = "/apps/hub";

// Shape Shopify allows for a proxy path: an allowed prefix plus a subpath of up to 30 characters.
const PROXY_PATH = /^\/(a|apps|community|tools)\/[A-Za-z0-9_-]{1,30}$/;

/**
 * Sign-in link that brings the customer back to `path` afterwards. With new customer accounts,
 * routes.account_login_url always lands on the orders page; /customer_authentication/login with
 * a relative return_to comes back to the store page instead.
 */
export const signInUrl = (path: string) => `/customer_authentication/login?return_to=${encodeURIComponent(path)}`;

export async function portalContext(request: Request) {
  const { admin, session, liquid } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const loggedIn = url.searchParams.get("logged_in_customer_id");
  const prefix = url.searchParams.get("path_prefix") ?? "";
  return {
    admin: admin as AdminGraphql | undefined,
    shop: session?.shop ?? url.searchParams.get("shop") ?? "",
    customerId: loggedIn ? `gid://shopify/Customer/${loggedIn}` : null,
    liquid,
    /** Where this store serves the proxy, e.g. "/apps/hub": the base for every link we render. */
    base: PROXY_PATH.test(prefix) ? prefix : PORTAL_PATH,
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
