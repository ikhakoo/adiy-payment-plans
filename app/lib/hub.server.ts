// Customer hub shell: the shared sidebar layout and the per-request context every hub page needs.
// Pages are HTML strings returned as Liquid through the app proxy (see portal.server.ts), so all
// customer- or merchant-supplied text must go through esc().
import { eligibleOrders, isTestMode, portalAllowed, rewardSettings } from "./rewards.server";
import { esc, portalContext, signInUrl } from "./portal.server";

// Changes on every deploy so browsers fetch the current stylesheet and scripts instead of cached ones.
export const ASSET_VERSION = Date.now().toString(36);
export const asset = (file: string) => `${process.env.SHOPIFY_APP_URL}/${file}?v=${ASSET_VERSION}`;

export type HubSection =
  | "overview"
  | "orders"
  | "track"
  | "resources"
  | "rewards"
  | "refer"
  | "support"
  | "account";

const ICONS: Record<HubSection, string> = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  orders: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  track: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  resources: '<path d="M12 3 4 21M12 3l8 18M7.5 13h9"/>',
  rewards: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0z"/>',
  refer: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  support: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  account: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
};
export const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ARROW = icon('<path d="M5 12h14M12 5l7 7-7 7"/>');

// `live: true` sections are built in later phases and stay out of the nav until then.
const NAV: { group: string; items: { key: HubSection; label: string; path: string; live: boolean }[] }[] = [
  {
    group: "Your deck",
    items: [
      { key: "overview", label: "Overview", path: "", live: true },
      { key: "orders", label: "My Orders", path: "/orders", live: true },
      { key: "track", label: "Track My Deck", path: "/track", live: true },
      { key: "resources", label: "Build Resources", path: "/resources", live: true },
    ],
  },
  {
    group: "Your rewards",
    items: [
      { key: "rewards", label: "Rewards", path: "/rewards", live: true },
      { key: "refer", label: "Refer a Friend", path: "/refer", live: true },
    ],
  },
  {
    group: "Your account",
    items: [
      { key: "support", label: "Help & Support", path: "/support", live: true },
      { key: "account", label: "Account & Addresses", path: "/account", live: true },
    ],
  },
];

/** Link builder for one store's proxy path (`base` comes from portalContext). */
export const hubLinks = (base: string) => (path = "") => `${base}${path}`;

const head = () => `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap">
<link rel="stylesheet" href="${asset("hub.css")}">`;

/** A hub page: sidebar nav + breadcrumb + content. */
export function hubPage({
  base,
  active,
  title,
  customerName,
  testMode = false,
  body,
}: {
  base: string;
  active: HubSection | null;
  title: string;
  customerName?: string | null;
  testMode?: boolean;
  body: string;
}) {
  const url = hubLinks(base);
  const nav = NAV.map((g) => {
    const items = g.items.filter((i) => i.live);
    if (!items.length) return "";
    return `<div class="hub-nav-group"><span>${g.group}</span>${items
      .map(
        (i) =>
          `<a href="${url(i.path)}"${i.key === active ? ' class="active" aria-current="page"' : ""}>${icon(ICONS[i.key])}${i.label}</a>`,
      )
      .join("")}</div>`;
  }).join("");
  const initial = (customerName ?? "").trim().charAt(0).toUpperCase() || "A";
  return `${head()}
<div class="hub">
  <div class="hub-shell">
    <aside class="hub-side">
      <a class="hub-brand" href="${url()}" style="text-decoration:none"><i>A</i>A-DIY HUB</a>
      <nav class="hub-nav" aria-label="Hub">${nav}</nav>
      ${customerName ? `<div class="hub-user"><i>${esc(initial)}</i><div><b>${esc(customerName)}</b><small>A-DIY customer</small></div></div>` : ""}
    </aside>
    <main class="hub-main">
      <div class="hub-crumb">Portal / <b>${esc(title)}</b></div>
      ${testMode ? `<div class="notice warn"><strong>Test mode</strong>: the hub isn't live yet. As a tester you can use any of your orders, even unfulfilled ones.</div>` : ""}
      ${body}
    </main>
  </div>
</div>
<script src="${asset("hub.js")}" defer></script>`;
}

/** Hub styling without the sidebar, for pages outside a signed-in customer's hub (referral landing). */
export function hubBarePage(body: string) {
  return `${head()}<div class="hub"><div class="hub-bare">${body}</div></div>`;
}

/** Path inside the hub the visitor asked for, minus Shopify's signed proxy params — for sign-in return. */
function returnPath(request: Request, base: string) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/proxy/, "");
  const params = new URLSearchParams(url.search);
  for (const k of ["shop", "logged_in_customer_id", "path_prefix", "timestamp", "signature"]) params.delete(k);
  const qs = params.toString();
  return `${base}${path === "/" ? "" : path}${qs ? `?${qs}` : ""}`;
}

/**
 * Everything a signed-in hub page needs. Returns `{ page }` — a ready response — when the visitor
 * can't see the hub (signed out, app unavailable, soft launch), otherwise `{ ctx }`.
 * Both keys are always present so callers can destructure and narrow with `if (page) return page`.
 */
export async function hubContext(request: Request) {
  const { admin, shop, customerId, liquid, base } = await portalContext(request);

  if (!customerId) {
    return {
      ctx: null,
      page: liquid(
        hubBarePage(`
          <div class="card" style="text-align:center;padding:40px 28px">
            <div class="eyebrow">Your deck. All in one place.</div>
            <h1 class="h1">Welcome to your A-DIY Hub</h1>
            <p class="lede" style="margin:0 auto 20px">Track your order, find your build resources, earn rewards and get help, all in one place.</p>
            <p class="muted">Sign in with the email you ordered with. We'll send you a one-time code, no password needed.</p>
            <a class="btn" href="${esc(signInUrl(returnPath(request, base)))}">Sign in</a>
          </div>`),
      ),
    } as const;
  }
  if (!admin) {
    return { ctx: null, page: liquid(hubBarePage(`<h1 class="h1">A-DIY Hub</h1><p>The hub isn't available right now. Please try again shortly.</p>`)) } as const;
  }

  const settings = await rewardSettings(shop);
  const data = await eligibleOrders(admin, customerId, settings.eligibleDays, { testMode: !settings.portalEnabled });
  if (!portalAllowed(settings, data?.email)) {
    return { ctx: null, page: liquid(hubBarePage(`<h1 class="h1">A-DIY Hub</h1><p>Coming soon: your orders, build resources and rewards, all in one place.</p>`)) } as const;
  }

  return {
    page: null,
    ctx: {
      admin,
      base,
      /** Builds a link inside this store's hub, e.g. url("/rewards") → "/apps/hub/rewards". */
      url: hubLinks(base),
      shop,
      customerId,
      liquid,
      settings,
      customerName: data?.name ?? null,
      firstName: data?.name?.split(" ")[0] ?? null,
      email: data?.email ?? null,
      /** Orders that can earn rewards (delivered, not cancelled or refunded, not installments). */
      rewardOrders: data?.orders ?? [],
      testMode: isTestMode(settings, data?.email),
    },
  } as const;
}

export type HubContext = NonNullable<Awaited<ReturnType<typeof hubContext>>["ctx"]>;

/** Shorthand used by every hub route: wrap a body in the shell and return it as Liquid. */
export const renderHub = (ctx: HubContext, active: HubSection | null, title: string, body: string) =>
  ctx.liquid(hubPage({ base: ctx.base, active, title, customerName: ctx.customerName, testMode: ctx.testMode, body }));
