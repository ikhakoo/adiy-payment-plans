import { describe, expect, it } from "vitest";
import { resourcesForOrder, specForOrder, type ResourceRow } from "./resources";

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
