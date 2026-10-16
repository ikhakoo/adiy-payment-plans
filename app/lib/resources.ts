// Which build resources and kit spec an order's customer sees. Pure, so it's unit-tested
// (resources.test.ts); resources.server.ts loads the rows.

export type ResourceSectionKey = "HERO" | "BEFORE" | "BUILD" | "AFTER";
export const SECTIONS: ResourceSectionKey[] = ["HERO", "BEFORE", "BUILD", "AFTER"];

export interface OrderLine {
  productId: string | null;
  variantId: string | null;
}

export interface ResourceRow {
  id: string;
  productId: string;
  variantId: string | null;
  section: ResourceSectionKey;
  title: string;
  position: number;
}

export interface SpecRow {
  productId: string;
  variantId: string | null;
}

const applies = (line: OrderLine, row: { productId: string; variantId: string | null }) =>
  !!line.productId && row.productId === line.productId && (!row.variantId || row.variantId === line.variantId);

/**
 * Resources for an order, grouped by section and sorted by position. For each line: the product's
 * resources for every size plus those for the line's size, where a size-specific resource replaces
 * an all-sizes one with the same section and title. Lines of the same product don't repeat rows.
 */
export function resourcesForOrder<T extends ResourceRow>(lines: OrderLine[], resources: T[]) {
  const picked = new Map<string, T>(); // by id, across lines
  for (const line of lines) {
    const chosen = new Map<string, T>(); // by section + title, within this line
    for (const r of resources) {
      if (!applies(line, r)) continue;
      const key = `${r.section}|${r.title.trim().toLowerCase()}`;
      const current = chosen.get(key);
      if (!current || (r.variantId && !current.variantId)) chosen.set(key, r);
    }
    for (const r of chosen.values()) picked.set(r.id, r);
  }
  const sorted = [...picked.values()].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const grouped = Object.fromEntries(SECTIONS.map((s) => [s, [] as T[]])) as Record<ResourceSectionKey, T[]>;
  for (const r of sorted) grouped[r.section].push(r);
  return grouped;
}

/** Kit spec for an order: the first line that has one, the size-specific spec beating the all-sizes one. */
export function specForOrder<T extends SpecRow>(lines: OrderLine[], specs: T[]) {
  for (const line of lines) {
    const matching = specs.filter((s) => applies(line, s));
    const spec = matching.find((s) => s.variantId) ?? matching[0];
    if (spec) return { spec, line };
  }
  return null;
}

// ---------------------------------------------------------------- size metafields

/** A deck size's build files, as set on the variant in Shopify (namespace "custom"). */
export interface VariantFiles {
  productId: string;
  variantId: string;
  /** custom.product_manuals_pdf */
  manual: { url: string; updatedAt: string } | null;
  /** custom.footing_diagrams_pdf */
  footing: { url: string; updatedAt: string } | null;
  /** custom.video_links */
  video: { url: string; updatedAt: string } | null;
  /** custom.3d_app_links */
  app3d: { url: string; updatedAt: string } | null;
}

/** Resource rows (as if entered in the editor for that size) from a variant's metafields. */
export function metafieldResources(v: VariantFiles) {
  const row = (
    key: string,
    f: { url: string; updatedAt: string } | null,
    section: ResourceSectionKey,
    kind: "PDF" | "GUIDE" | "VIDEO" | "APP_3D",
    title: string,
    description: string | null,
  ) =>
    f && {
      id: `mf:${v.variantId}:${key}`,
      shop: "",
      productId: v.productId,
      productTitle: null,
      variantId: v.variantId,
      variantTitle: null,
      section,
      kind,
      title,
      description,
      url: f.url,
      meta: null,
      // Ahead of anything entered in the editor for the same slot.
      position: -1,
      createdAt: new Date(f.updatedAt),
      updatedAt: new Date(f.updatedAt),
    };
  return [
    // The manual is both the hero's "Download guide" and the Installation Guide row.
    row("manual-hero", v.manual, "HERO", "GUIDE", "Installation Guide", null),
    row("manual", v.manual, "BUILD", "GUIDE", "Installation Guide", null),
    row("footing", v.footing, "BEFORE", "PDF", "Footing Plan", null),
    row("video", v.video, "BUILD", "VIDEO", "Assembly videos", null),
    row("app3d", v.app3d, "BUILD", "APP_3D", "3D instructional app", "Interactive, step-by-step 3D instructions for your deck kit."),
  ].filter((r) => !!r);
}

// ---------------------------------------------------------------- page layout (Figma "resources")

export type LayoutSection = Exclude<ResourceSectionKey, "HERO">;

/** One fixed item from the design. It shows without a link until a matching resource is uploaded. */
export interface Slot {
  key: string;
  section: LayoutSection;
  title: string;
  description: string;
  /** Tag shown at the right of the row when the resource has no `meta` of its own. */
  tag: string;
  /** Resource titles that fill this slot. */
  match: RegExp;
  /** Fallback when no title matches: the first unused resource of this kind in the section. */
  kind?: string;
}

export const SLOTS: Slot[] = [
  { key: "site-prep", section: "BEFORE", title: "Site preparation checklist", description: "Get your build area ready before you start.", tag: "PDF", match: /site|prep/i },
  { key: "footing", section: "BEFORE", title: "Footing Plan", description: "See where to place the foundation blocks for your deck.", tag: "PDF", match: /footing|foundation|block/i },
  { key: "tools", section: "BEFORE", title: "Tools & parts checklist", description: "Check your kit contents and gather the tools you’ll need.", tag: "Checklist", match: /tool|parts|contents/i, kind: "CHECKLIST" },
  { key: "install", section: "BUILD", title: "Installation Guide", description: "Follow the instructions to build your deck, step by step.", tag: "GUIDE", match: /install|assembly (guide|instructions|manual)/i },
  { key: "videos", section: "BUILD", title: "Assembly videos", description: "Watch how your deck comes together, one step at a time.", tag: "VIDEOS", match: /video/i, kind: "VIDEO" },
  { key: "steps", section: "BUILD", title: "Steps & railing instructions", description: "Find assembly instructions for your steps and railings.", tag: "GUIDE", match: /step|stair|rail/i },
  { key: "care", section: "AFTER", title: "Care & maintenance guide", description: "Learn how to care for your deck and keep it in good condition.", tag: "Guide", match: /care|mainten|clean/i },
  { key: "warranty", section: "AFTER", title: "Warranty documents", description: "View your deck’s warranty coverage and how to make a claim.", tag: "PDF", match: /warrant|claim/i },
];

export interface LayoutItem<T> {
  /** The design slot this row fills, or null for an extra resource the merchant added. */
  slot: Slot | null;
  /** The uploaded resource, or null until one is uploaded (the row then shows without a link). */
  resource: T | null;
}

/**
 * The page's three sections in the design's order: every slot is listed (filled with a matching
 * resource or left empty), followed by the section's other resources. A slot takes the first
 * resource of its section whose title matches, else the first unused one of its `kind`; the
 * installation-guide slot falls back to the "Start here" guide. Also picks the hero's guide and video.
 */
export function pageLayout<T extends ResourceRow & { kind: string }>(sections: Record<ResourceSectionKey, T[]>) {
  const used = new Set<string>();
  const filled = new Map<string, T>();
  const take = (slot: Slot, pick: (r: T) => boolean) => {
    if (filled.has(slot.key)) return;
    const r = sections[slot.section].find((x) => !used.has(x.id) && pick(x));
    if (r) {
      filled.set(slot.key, r);
      used.add(r.id);
    }
  };
  for (const slot of SLOTS) take(slot, (r) => slot.match.test(r.title));
  for (const slot of SLOTS) if (slot.kind) take(slot, (r) => r.kind === slot.kind);

  const heroGuide = sections.HERO.find((r) => r.kind !== "VIDEO") ?? null;
  if (!filled.has("install") && heroGuide) filled.set("install", heroGuide);

  const layout = {} as Record<LayoutSection, LayoutItem<T>[]>;
  for (const section of ["BEFORE", "BUILD", "AFTER"] as const) {
    layout[section] = [
      ...SLOTS.filter((s) => s.section === section).map((slot) => ({ slot, resource: filled.get(slot.key) ?? null })),
      ...sections[section].filter((r) => !used.has(r.id)).map((resource) => ({ slot: null, resource })),
    ];
  }

  const all = [...sections.HERO, ...sections.BEFORE, ...sections.BUILD, ...sections.AFTER];
  // "Download guide" is only ever the installation guide, never some other PDF.
  const guide = heroGuide ?? filled.get("install") ?? null;
  const video = sections.HERO.find((r) => r.kind === "VIDEO") ?? filled.get("videos") ?? all.find((r) => r.kind === "VIDEO") ?? null;
  return { sections: layout, guide, video };
}

// ---------------------------------------------------------------- deck overview

/** "10 × 12 ft", "10x12", "10' x 12'", "10′ × 12′ Freestanding" → { width: 10, length: 12 }. */
export function parseDeckSize(text: string | null | undefined) {
  const m = text?.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|['′])?\s*[x×X]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const width = Number(m[1]);
  const length = Number(m[2]);
  return width > 0 && length > 0 ? { width, length } : null;
}

export interface KitSpecFields {
  specLabel: string | null;
  buildTime: string | null;
  deckSize: string | null;
}

/**
 * What the hero spec box and the "Deck size" card show: the kit spec the merchant entered, or
 * else what the order's line item says (its size variant, else the product title). Nothing made up.
 */
export function deckOverview(spec: KitSpecFields | null, line: { title: string; variantTitle: string | null } | null) {
  const variant = line?.variantTitle && line.variantTitle !== "Default Title" ? line.variantTitle.trim() : null;
  const dims = parseDeckSize(spec?.specLabel) ?? parseDeckSize(variant) ?? parseDeckSize(line?.title);
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const dimsText = dims ? `${fmt(dims.width)} × ${fmt(dims.length)} ft` : null;
  const area = spec?.deckSize?.trim() || (dims ? `${fmt(dims.width * dims.length)} sq ft` : null);
  return {
    /** For "your [size] deck kit" in the hero text. */
    size: dimsText ?? variant,
    /** Big number on the Deck size card, and the line under it. */
    area: area ?? dimsText ?? variant ?? line?.title ?? null,
    areaSub: area ? (dimsText ?? variant) : null,
    specLabel: spec?.specLabel?.trim() || (dims ? `${fmt(dims.width)}′ × ${fmt(dims.length)}′` : variant) || line?.title || null,
    buildTime: spec?.buildTime?.trim() || null,
  };
}

/** "Estimated build" when the kit spec has no build time: the row stays, but no duration is made up. */
export const BUILD_TIME_UNSET = "To be confirmed";

/** The "Readiness" card, from where the deck is in its journey (tracking.ts's DeckStep). */
export function readiness(step: "production" | "packing" | "shipped" | "delivered") {
  if (step === "delivered") return { stage: "03", label: "Ready to build", percent: 75 };
  if (step === "shipped") return { stage: "02", label: "Arriving soon", percent: 50 };
  return { stage: "01", label: "Ready to prep", percent: 25 };
}

/** "Updated 3 days ago" under the Overview's resources card, from the newest resource's updatedAt. */
export function updatedAgo(rows: { updatedAt: Date }[], now = new Date()) {
  if (!rows.length) return null;
  const latest = rows.reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), rows[0].updatedAt);
  const days = Math.max(0, Math.floor((now.getTime() - latest.getTime()) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated 1 day ago";
  if (days < 60) return `Updated ${days} days ago`;
  return `Updated ${latest.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
