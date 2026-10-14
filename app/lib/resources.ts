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
