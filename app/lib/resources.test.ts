import { describe, expect, it } from "vitest";
import { deckOverview, pageLayout, parseDeckSize, readiness, resourcesForOrder, SLOTS, specForOrder, type ResourceRow } from "./resources";

const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
const V10 = "gid://shopify/ProductVariant/10";
const V12 = "gid://shopify/ProductVariant/12";

let n = 0;
const res = (r: Partial<ResourceRow>): ResourceRow => ({
  id: `r${++n}`,
  productId: P1,
  variantId: null,
  section: "BEFORE",
  title: "Footing plan",
  position: 0,
  ...r,
});
const titles = (rs: ResourceRow[]) => rs.map((r) => r.title);

describe("resourcesForOrder", () => {
  it("includes all-sizes resources and the line's own size, not other sizes or products", () => {
    const rows = [
      res({ title: "Site prep" }),
      res({ title: "Footing 10", variantId: V10 }),
      res({ title: "Footing 12", variantId: V12 }),
      res({ title: "Other product", productId: P2 }),
    ];
    const out = resourcesForOrder([{ productId: P1, variantId: V10 }], rows);
    expect(titles(out.BEFORE).sort()).toEqual(["Footing 10", "Site prep"]);
  });

  it("lets a size-specific resource replace an all-sizes one with the same section and title", () => {
    const all = res({ title: "Installation Guide", section: "BUILD" });
    const sized = res({ title: "installation guide ", section: "BUILD", variantId: V10 });
    const sameTitleOtherSection = res({ title: "Installation Guide", section: "HERO" });
    for (const rows of [[all, sized, sameTitleOtherSection], [sized, all, sameTitleOtherSection]]) {
      const out = resourcesForOrder([{ productId: P1, variantId: V10 }], rows);
      expect(out.BUILD.map((r) => r.id)).toEqual([sized.id]);
      expect(out.HERO.map((r) => r.id)).toEqual([sameTitleOtherSection.id]);
    }
    const other = resourcesForOrder([{ productId: P1, variantId: V12 }], [all, sized]);
    expect(other.BUILD.map((r) => r.id)).toEqual([all.id]);
  });

  it("dedupes across lines of the same product and groups by section in position order", () => {
    const rows = [
      res({ title: "Warranty", section: "AFTER", position: 2 }),
      res({ title: "Care guide", section: "AFTER", position: 1 }),
      res({ title: "Tools", section: "BEFORE", position: 5 }),
      res({ title: "Stairs", section: "BUILD", productId: P2 }),
    ];
    const out = resourcesForOrder(
      [
        { productId: P1, variantId: V10 },
        { productId: P1, variantId: V12 },
        { productId: P2, variantId: null },
        { productId: null, variantId: null },
      ],
      rows,
    );
    expect(titles(out.AFTER)).toEqual(["Care guide", "Warranty"]);
    expect(titles(out.BEFORE)).toEqual(["Tools"]);
    expect(titles(out.BUILD)).toEqual(["Stairs"]);
    expect(out.HERO).toEqual([]);
  });

  it("returns empty sections for an order without configured products", () => {
    const out = resourcesForOrder([{ productId: P2, variantId: null }], [res({})]);
    expect(Object.values(out).flat()).toEqual([]);
  });
});

describe("specForOrder", () => {
  const all = { id: "all", productId: P1, variantId: null };
  const ten = { id: "ten", productId: P1, variantId: V10 };

  it("prefers the size-specific spec over the all-sizes one", () => {
    expect(specForOrder([{ productId: P1, variantId: V10 }], [all, ten])?.spec.id).toBe("ten");
    expect(specForOrder([{ productId: P1, variantId: V10 }], [ten, all])?.spec.id).toBe("ten");
    expect(specForOrder([{ productId: P1, variantId: V12 }], [ten, all])?.spec.id).toBe("all");
  });

  it("uses the first line that has a spec, and null when none does", () => {
    const lines = [
      { productId: P2, variantId: null },
      { productId: P1, variantId: V12 },
    ];
    const found = specForOrder(lines, [ten, all]);
    expect(found?.spec.id).toBe("all");
    expect(found?.line).toBe(lines[1]);
    expect(specForOrder([{ productId: P1, variantId: V12 }], [ten])).toBeNull();
  });
});

describe("pageLayout", () => {
  type Row = ResourceRow & { kind: string };
  const row = (r: Partial<Row>): Row => ({ ...res({}), kind: "PDF", ...r });
  const empty = () => ({ HERO: [] as Row[], BEFORE: [] as Row[], BUILD: [] as Row[], AFTER: [] as Row[] });

  it("lists every design item as coming soon when nothing is uploaded", () => {
    const out = pageLayout(empty());
    expect(out.sections.BEFORE.map((i) => i.slot?.title)).toEqual(["Site preparation checklist", "Footing Plan", "Tools & parts checklist"]);
    expect(out.sections.BUILD.map((i) => i.slot?.title)).toEqual(["Installation Guide", "Assembly videos", "Steps & railing instructions"]);
    expect(out.sections.AFTER.map((i) => i.slot?.title)).toEqual(["Care & maintenance guide", "Warranty documents"]);
    expect(Object.values(out.sections).flat().every((i) => i.resource === null)).toBe(true);
    expect(out.guide).toBeNull();
    expect(out.video).toBeNull();
    expect(SLOTS).toHaveLength(8);
  });

  it("fills slots by title, then by kind, and appends the rest", () => {
    const s = empty();
    const footing = row({ title: "Footing plan 10x12", section: "BEFORE" });
    const tools = row({ title: "What's in the box", section: "BEFORE", kind: "CHECKLIST" });
    const extra = row({ title: "Permit tips", section: "BEFORE" });
    const vid = row({ title: "Watch: framing", section: "BUILD", kind: "VIDEO" });
    const app = row({ title: "Interactive 3D guide", section: "BUILD", kind: "APP_3D" });
    const warranty = row({ title: "Warranty", section: "AFTER" });
    s.BEFORE.push(footing, tools, extra);
    s.BUILD.push(vid, app);
    s.AFTER.push(warranty);
    const out = pageLayout(s);
    expect(out.sections.BEFORE.map((i) => [i.slot?.key ?? null, i.resource?.id ?? null])).toEqual([
      ["site-prep", null],
      ["footing", footing.id],
      ["tools", tools.id],
      [null, extra.id],
    ]);
    expect(out.sections.BUILD.map((i) => [i.slot?.key ?? null, i.resource?.id ?? null])).toEqual([
      ["install", null],
      ["videos", vid.id],
      ["steps", null],
      [null, app.id],
    ]);
    expect(out.sections.AFTER.map((i) => i.resource?.id ?? null)).toEqual([null, warranty.id]);
    expect(out.video?.id).toBe(vid.id);
    expect(out.guide).toBeNull();
  });

  it("uses the Start here guide for the hero and the installation guide row", () => {
    const s = empty();
    const hero = row({ title: "Your installation guide", section: "HERO" });
    s.HERO.push(hero);
    const out = pageLayout(s);
    expect(out.guide?.id).toBe(hero.id);
    expect(out.sections.BUILD[0].resource?.id).toBe(hero.id);
    // A dedicated Build-section guide wins the row; the hero keeps the Start here file.
    const own = row({ title: "Installation Guide", section: "BUILD" });
    s.BUILD.push(own);
    const out2 = pageLayout(s);
    expect(out2.sections.BUILD[0].resource?.id).toBe(own.id);
    expect(out2.guide?.id).toBe(hero.id);
  });
});

describe("deck overview", () => {
  it("parses common size spellings", () => {
    expect(parseDeckSize("10 × 12 ft")).toEqual({ width: 10, length: 12 });
    expect(parseDeckSize("10' x 12'")).toEqual({ width: 10, length: 12 });
    expect(parseDeckSize("10′ × 12′ Freestanding")).toEqual({ width: 10, length: 12 });
    expect(parseDeckSize("12X16")).toEqual({ width: 12, length: 16 });
    expect(parseDeckSize("Default Title")).toBeNull();
    expect(parseDeckSize(null)).toBeNull();
  });

  it("prefers the kit spec", () => {
    const o = deckOverview({ specLabel: "10′ × 12′ Freestanding", buildTime: "1.5 - 2 Days (2 adults)", deckSize: "120 sq ft" }, { title: "Deck Kit", variantTitle: "10 × 12 ft" });
    expect(o).toEqual({ size: "10 × 12 ft", area: "120 sq ft", areaSub: "10 × 12 ft", specLabel: "10′ × 12′ Freestanding", buildTime: "1.5 - 2 Days (2 adults)" });
  });

  it("falls back to the line item without inventing a build time", () => {
    expect(deckOverview(null, { title: "Deck Kit", variantTitle: "12x16" })).toEqual({ size: "12 × 16 ft", area: "192 sq ft", areaSub: "12 × 16 ft", specLabel: "12′ × 16′", buildTime: null });
    expect(deckOverview(null, { title: "Deck Kit", variantTitle: "Default Title" })).toEqual({ size: null, area: "Deck Kit", areaSub: null, specLabel: "Deck Kit", buildTime: null });
    expect(deckOverview(null, { title: "Deck Kit", variantTitle: "Cedar" })).toMatchObject({ size: "Cedar", area: "Cedar", specLabel: "Cedar" });
  });

  it("maps the deck's journey to a readiness stage", () => {
    expect(readiness("production")).toEqual({ stage: "01", label: "Ready to prep", percent: 25 });
    expect(readiness("packing").stage).toBe("01");
    expect(readiness("shipped").stage).toBe("02");
    expect(readiness("delivered")).toMatchObject({ stage: "03", label: "Ready to build" });
  });
});
