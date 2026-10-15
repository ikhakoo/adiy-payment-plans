import type { LoaderFunctionArgs } from "react-router";
import type { BuildResource, ResourceKind } from "@prisma/client";
import { esc } from "../lib/portal.server";
import { ARROW, asset, hubContext, icon, renderHub } from "../lib/hub.server";
import { mainLine, orderSwitcher, selectedOrder } from "../lib/orders.server";
import { orderResources } from "../lib/resources.server";
import { deckOverview, pageLayout, readiness, type LayoutItem } from "../lib/resources";
import { deckProgress } from "../lib/tracking";

const I = {
  folder: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
  compass: '<path d="m12.99 6.74 1.93 3.44M19.14 12a10 10 0 0 1-14.27 0M21 21l-2.16-3.84M3 21l8.02-14.26"/><circle cx="12" cy="5" r="2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  checklist: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 13h4M7 17h4M14 14l2 2 3-4"/>',
  footing: '<path d="M4 9h16M4 15h16M9 4v16M15 4v16"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  video: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  stairs: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 17h3v-3h3v-3h3V8"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  badge: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  out: '<path d="M7 7h10v10M7 17 17 7"/>',
  help: '<circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><circle cx="18" cy="18" r="3"/><path d="m21.7 19.4-.9-.3M15.2 16.9l-.9-.4M16.6 21.7l.3-.9M19.1 15.2l.4-.9M19.4 21.7l-.4-1M16.9 15.2l-.4-1M21.7 16.6l-.9.4M15.2 19.1l-.9.4"/>',
  cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
  link: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
};

/** Icon per design slot, and per resource kind for extra rows. */
const SLOT_ICON: Record<string, string> = {
  "site-prep": I.checklist,
  footing: I.footing,
  tools: I.archive,
  install: I.book,
  videos: I.video,
  steps: I.stairs,
  care: I.shield,
  warranty: I.badge,
};
const KIND: Record<ResourceKind, { tag: string; icon: string }> = {
  PDF: { tag: "PDF", icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>' },
  VIDEO: { tag: "Videos", icon: I.video },
  CHECKLIST: { tag: "Checklist", icon: I.checklist },
  GUIDE: { tag: "Guide", icon: I.book },
  LINK: { tag: "Link", icon: I.link },
  APP_3D: { tag: "3D app", icon: I.cube },
};

const link = (r: BuildResource) => `href="${esc(r.url)}" target="_blank" rel="noopener"`;
const SOON = `<span class="res-soon">Coming soon</span>`;

function itemParts({ slot: s, resource: r }: LayoutItem<BuildResource>) {
  return {
    title: esc(s?.title ?? r?.title ?? ""),
    // The design's copy for its own items; the merchant's description for extra rows.
    text: esc(s ? s.description : [r?.description, r?.meta].filter(Boolean).join(" · ")),
    tag: esc(r?.meta || (s ? s.tag : r ? KIND[r.kind].tag : "")),
    ico: s ? SLOT_ICON[s.key] : r ? KIND[r.kind].icon : I.link,
  };
}

/** A row in "Before you build" / "Assembly guides": a link once uploaded, otherwise "Coming soon". */
function row(item: LayoutItem<BuildResource>) {
  const p = itemParts(item);
  const inner = `<span class="res-i-ico">${icon(p.ico)}</span>
      <span class="res-i-text"><b>${p.title}</b>${p.text ? `<span>${p.text}</span>` : ""}</span>
      ${item.resource ? `<span class="res-tag">${p.tag}</span>` : SOON}`;
  return item.resource
    ? `<li><a class="res-item" ${link(item.resource)}>${inner}</a></li>`
    : `<li><div class="res-item is-soon" aria-disabled="true">${inner}</div></li>`;
}

/** A tile in "After your build". */
function tile(item: LayoutItem<BuildResource>) {
  const p = itemParts(item);
  const inner = `<span class="res-t-ico">${icon(p.ico)}</span>
      <span class="res-i-text"><b>${p.title}${item.resource ? icon(I.out) : ""}</b>${p.text ? `<span>${p.text}</span>` : ""}${item.resource ? "" : SOON}</span>`;
  return item.resource
    ? `<a class="res-tile" ${link(item.resource)}>${inner}</a>`
    : `<div class="res-tile is-soon" aria-disabled="true">${inner}</div>`;
}

function sectionHead(dot: string, heading: string, aside: string) {
  return `<div class="res-sec-head"><h2><i class="res-dot ${dot}"></i>${heading}</h2><span class="res-cap">${aside}</span></div>`;
}

// GET /apps/hub/resources — Build Resources for the selected order's kit: the installation guide,
// deck overview, and every design item (plans, guides, videos), "Coming soon" until it's uploaded.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;
  const { orders, order } = await selectedOrder(ctx, request);

  const help = `<div class="res-help">
      <span class="res-help-ico">${icon(I.help)}</span>
      <div><h3>Need help with your build?</h3><p>Send us a photo or your question. Our Deck Specialists are here to help.</p></div>
      <a class="res-help-btn" href="${ctx.url("/support")}" data-hub-chat>Chat now</a>
    </div>`;
  const head = `<div class="res-head">
      <h1>Everything you need to build your deck.</h1>
      <p>Your plans, instructions, videos, and interactive 3D guide for your deck kit.</p>
      ${orderSwitcher(ctx, "/resources", orders, order)}
    </div>`;

  if (!order) {
    return renderHub(
      ctx,
      "resources",
      "Build Resources",
      `<div class="res-page">${head}<div class="res-card"><h2 class="h3">No orders yet</h2>
        <p class="muted" style="margin:0 0 20px">Your installation guide, plans and assembly videos will appear here once you've ordered a deck kit with the email you signed in with.</p>${help}</div></div>`,
    );
  }

  const { sections, spec, specLine } = await orderResources(ctx.shop, order.lineItems);
  const { sections: layout, guide, video } = pageLayout(sections);
  // The kit the page is about: the line with a spec, else the order's first line.
  const line = specLine ?? mainLine(order);
  const deck = deckOverview(spec, line);
  const ready = readiness(deckProgress(order).step);

  const specRow = (ico: string, label: string, value: string) =>
    `<div class="res-spec-row">${icon(ico)}<div><span>${label}</span><b>${esc(value)}</b></div></div>`;
  const specs = [deck.specLabel && specRow(I.compass, "Kit spec", deck.specLabel), deck.buildTime && specRow(I.clock, "Estimated build", deck.buildTime)]
    .filter(Boolean)
    .join(`<hr>`);

  const hero = `<section class="res-hero2">
      <div class="res-hero-main">
        <div class="res-hero-top"><span class="res-chip">Start here</span><span class="res-hero-order">Order ${esc(order.name)} · Verified Blueprint</span></div>
        <h2>Your installation guide</h2>
        <p>Follow the assembly instructions for your ${deck.size ? `${esc(deck.size)} ` : ""}deck kit, with videos to help along the way.</p>
        <div class="res-hero-btns">
          ${
            guide
              ? `<a class="res-btn white" ${link(guide)}>${icon(I.folder)}Download guide${ARROW}</a>`
              : `<span class="res-btn white is-soon" aria-disabled="true">${icon(I.folder)}Guide coming soon</span>`
          }
          ${
            video
              ? `<a class="res-btn ghost" ${link(video)}>${icon(I.play)}Watch assembly video</a>`
              : `<span class="res-btn ghost is-soon" aria-disabled="true">${icon(I.play)}Video coming soon</span>`
          }
        </div>
      </div>
      ${specs ? `<div class="res-bento">${specs}</div>` : ""}
    </section>`;

  const overview = `<section class="res-ribbon2">
      <div class="res-ov" style="background-image:url('${asset("hub-img/res-blueprint.jpg")}')">
        <span class="res-cap">Deck size</span><b>${esc(deck.area ?? "Your deck kit")}</b>${deck.areaSub ? `<small>${esc(deck.areaSub)}</small>` : ""}
      </div>
      <div class="res-ov" style="background-image:url('${asset("hub-img/res-materials.jpg")}')">
        <span class="res-cap">Your materials</span><b>Cut to size</b><small>Prepared for assembly</small>
      </div>
      <div class="res-ov">
        <div class="res-ov-top"><span class="res-cap">Readiness</span><span class="res-stage">Stage ${ready.stage}</span></div>
        <b>${ready.label}</b>
        <div class="res-track" role="progressbar" aria-label="Readiness" aria-valuenow="${ready.percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${ready.percent}%"></span></div>
      </div>
    </section>`;

  const count = (n: number) => `${n} resource${n === 1 ? "" : "s"}`;
  const modules = `<section class="res-cols">
      <div class="res-card">${sectionHead("gold", "Before you build", count(layout.BEFORE.length))}<ul class="res-items">${layout.BEFORE.map(row).join("")}</ul></div>
      <div class="res-card">${sectionHead("green", "Assembly guides", "Core guides")}<ul class="res-items">${layout.BUILD.map(row).join("")}</ul></div>
    </section>`;

  const after = `<section class="res-card res-after">
      ${sectionHead("grey", "After your build", "Warranty &amp; care")}
      <div class="res-tiles">${layout.AFTER.map(tile).join("")}</div>
      ${help}
    </section>`;

  return renderHub(ctx, "resources", "Build Resources", `<div class="res-page">${head}${hero}${overview}${modules}${after}</div>`);
};
