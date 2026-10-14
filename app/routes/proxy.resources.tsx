import type { LoaderFunctionArgs } from "react-router";
import type { BuildResource, ResourceKind } from "@prisma/client";
import { esc } from "../lib/portal.server";
import { ARROW, hubContext, icon, renderHub } from "../lib/hub.server";
import { mainLine, orderSwitcher, selectedOrder } from "../lib/orders.server";
import { orderResources } from "../lib/resources.server";

const KIND: Record<ResourceKind, { tag: string; icon: string }> = {
  PDF: { tag: "PDF", icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>' },
  VIDEO: { tag: "Videos", icon: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>' },
  CHECKLIST: { tag: "Checklist", icon: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
  GUIDE: { tag: "Guide", icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
  LINK: { tag: "Link", icon: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>' },
  APP_3D: { tag: "App", icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>' },
};

const link = (r: BuildResource) => `href="${esc(r.url)}" target="_blank" rel="noopener"`;

/** One resource: icon, title, description and kind tag; the whole row opens the file in a new tab. */
function row(r: BuildResource) {
  const k = KIND[r.kind];
  const is3d = r.kind === "APP_3D";
  const sub = [r.description, r.meta].filter(Boolean).map(esc).join(" · ");
  return `<li><a class="res-row${is3d ? " res-3d" : ""}" ${link(r)}>
      <span class="res-ico">${icon(k.icon)}</span>
      <span class="res-text"><b>${esc(r.title)}</b>${is3d ? `<span class="label">3D instructional app</span>` : ""}${sub ? `<span class="muted">${sub}</span>` : ""}</span>
      ${is3d ? `<span class="btn">Launch ${ARROW}</span>` : `<span class="pill">${k.tag}</span>`}
    </a></li>`;
}

function card(eyebrow: string, heading: string, items: BuildResource[], extra = "") {
  if (!items.length) return "";
  return `<div class="card res-card${extra}">
      <div class="card-head">
        <div><div class="label">${eyebrow}</div><h2 class="h2" style="margin:4px 0 0">${heading}</h2></div>
        <span class="pill mint">${items.length} resource${items.length === 1 ? "" : "s"}</span>
      </div>
      <ul class="res-list">${items.map(row).join("")}</ul>
    </div>`;
}

// GET /apps/hub/resources — Build Resources: plans, guides, videos and the 3D app for the selected order's kit.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;
  const { orders, order } = await selectedOrder(ctx, request);

  const help = `<div class="banner">
      <div><div class="h3">Need help with your build?</div><p>Send us a photo or your question. Our Deck Specialists are here to help.</p></div>
      <a class="btn" href="${ctx.url("/support")}" data-hub-chat>Chat now</a>
    </div>`;
  const head = `<div class="page-head">
      <h1 class="h1">Everything you need to build your deck.</h1>
      <p class="lede">Your plans, instructions, videos, and interactive 3D guide for your deck kit.</p>
      ${orderSwitcher(ctx, "/resources", orders, order)}
    </div>`;

  if (!order) {
    return renderHub(
      ctx,
      "resources",
      "Build Resources",
      `${head}<div class="card flat"><h2 class="h3">No orders yet</h2>
        <p class="muted" style="margin:0">Your installation guide, plans and assembly videos will appear here once you've ordered a deck kit with the email you signed in with.</p></div>${help}`,
    );
  }

  const { sections, spec, specLine } = await orderResources(ctx.shop, order.lineItems);
  const all = [...sections.HERO, ...sections.BEFORE, ...sections.BUILD, ...sections.AFTER];
  if (!all.length && !spec) {
    return renderHub(
      ctx,
      "resources",
      "Build Resources",
      `${head}<div class="card flat"><h2 class="h3">Your build resources are being prepared…</h2>
        <p class="muted" style="margin:0">We're getting the plans and guides for order ${esc(order.name)} ready. Check back soon, or <a href="${ctx.url("/support")}">contact support</a> if you need them now.</p></div>${help}`,
    );
  }

  // The kit the page is about: the line with a spec, else the order's first line.
  const line = specLine ?? mainLine(order);
  const size = line?.variantTitle && line.variantTitle !== "Default Title" ? line.variantTitle : null;
  const guide =
    sections.HERO[0] ?? all.find((r) => r.section !== "HERO" && (r.kind === "GUIDE" || r.kind === "PDF"));
  const video = all.find((r) => r.kind === "VIDEO");
  const pills = [
    spec?.specLabel && `<span class="res-spec"><span class="label">Kit spec</span>${esc(spec.specLabel)}</span>`,
    spec?.buildTime && `<span class="res-spec"><span class="label">Estimated build</span>${esc(spec.buildTime)}</span>`,
  ]
    .filter(Boolean)
    .join("");

  const hero = `<div class="hero res-hero">
      <div class="res-hero-text">
        <div class="eyebrow">Start here</div>
        <div class="res-order">Order ${esc(order.name)}</div>
        <h2 class="h1">Your installation guide</h2>
        <p>Follow the assembly instructions for your ${size ? `${esc(size)} ` : ""}deck kit, with videos to help along the way.</p>
        ${
          guide || video
            ? `<div class="btn-row">
                ${guide ? `<a class="btn white" ${link(guide)}>Download guide</a>` : ""}
                ${video ? `<a class="btn res-ghost" ${link(video)}>Watch assembly video</a>` : ""}
              </div>`
            : ""
        }
        ${pills ? `<div class="res-specs">${pills}</div>` : ""}
      </div>
      ${line?.image ? `<div class="res-hero-img"><img src="${esc(line.image)}" alt="${esc(line.title)}" loading="lazy"></div>` : ""}
    </div>`;

  const ribbon =
    spec?.deckSize || size
      ? `<div class="res-ribbon">
          <div><span class="label">Deck size</span><b>${[spec?.deckSize, size].filter(Boolean).map(esc).join(" · ")}</b></div>
          <div><span class="label">Your materials</span><b>Cut to size</b><span class="muted">Prepared for assembly</span></div>
        </div>`
      : "";

  const before = card("Before you build", "Get ready", sections.BEFORE);
  const build = card("Assembly guides", "Core guides", sections.BUILD);
  const after = card("After your build", "Warranty &amp; care", sections.AFTER, " res-wide");

  const body = `${head}${hero}${ribbon}
    ${before && build ? `<div class="grid2">${before}${build}</div>` : before || build}
    ${after}
    ${help}`;
  return renderHub(ctx, "resources", "Build Resources", body);
};
