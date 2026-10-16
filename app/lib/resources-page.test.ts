// Build Resources page render, with the database, hub context and orders mocked: the design's items
// always show; the hero buttons and rows become links only when a resource has been uploaded.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ resources: [] as unknown[], specs: [] as unknown[] }));
vi.mock("../shopify.server", () => ({ authenticate: {} }));
vi.mock("../db.server", () => ({
  default: {
    buildResource: { findMany: async () => db.resources },
    kitSpec: { findMany: async () => db.specs },
  },
}));
vi.mock("./hub.server", async (orig) => ({
  ...((await orig()) as object),
  hubContext: async () => ({
    page: null,
    ctx: { shop: "s", base: "/apps/hub", url: (p = "") => `/apps/hub${p}`, liquid: (h: string) => new Response(h), customerName: "Ann", testMode: false },
  }),
}));
const P = "gid://shopify/Product/1";
vi.mock("./orders.server", async (orig) => {
  const order = {
    id: "gid://shopify/Order/1",
    numericId: "1",
    name: "#1042",
    createdAt: new Date().toISOString(),
    displayFulfillmentStatus: "UNFULFILLED",
    fulfillments: [],
    lineItems: [{ title: "Deck Kit", variantTitle: "16 × 20 ft", quantity: 1, image: null, productId: P, variantId: null }],
  };
  return { ...((await orig()) as object), selectedOrder: async () => ({ orders: [order], order }) };
});

let n = 0;
const resource = (section: string, kind: string, title: string, url: string, meta: string | null = null) => ({
  id: `r${++n}`, shop: "s", productId: P, variantId: null, section, kind, title, description: null, url, meta, position: n,
});

async function render() {
  const { loader } = await import("../routes/proxy.resources");
  const res = (await loader({ request: new Request("https://x/proxy/resources"), params: {}, context: {} } as never)) as Response;
  return res.text();
}

describe("Build Resources page", () => {
  beforeEach(() => {
    db.resources = [];
    db.specs = [];
  });

  it("shows every design item and inert hero buttons with the design's labels before anything is uploaded", async () => {
    const html = await render();
    expect(html).not.toMatch(/coming soon/i);
    expect(html).toMatch(/<span class="res-btn white is-pending" aria-disabled="true">.*Download guide/s);
    expect(html).toMatch(/<span class="res-btn ghost is-pending" aria-disabled="true">.*Watch assembly video/s);
    expect(html).not.toContain("<a class=\"res-btn");
    for (const title of ["Site preparation checklist", "Footing Plan", "Tools &amp; parts checklist", "Installation Guide", "Assembly videos", "Steps &amp; railing instructions", "Care &amp; maintenance guide", "Warranty documents"]) {
      expect(html).toContain(title);
    }
    expect(html).not.toContain("res-item\" href");
    expect([...html.matchAll(/<span class="res-tag">([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["PDF", "PDF", "Checklist", "GUIDE", "VIDEOS", "GUIDE"]);
    // No kit spec yet: the estimate row stays with an honest placeholder, the size comes from the order.
    expect(html).toContain("<span>Estimated build</span><b>To be confirmed</b>");
    expect(html).toContain("<span>Kit spec</span><b>16′ × 20′</b>");
  });

  it("turns the hero buttons and matching rows into links once resources exist", async () => {
    db.resources = [
      resource("HERO", "PDF", "Installation guide", "https://cdn/guide.pdf"),
      resource("BUILD", "VIDEO", "Assembly videos", "https://cdn/video.mp4"),
      resource("BUILD", "PDF", "Installation Guide", "https://cdn/full.pdf", "24 pgs"),
    ];
    db.specs = [{ id: "k", productId: P, variantId: null, specLabel: "16′ × 20′ Freestanding", buildTime: "2 - 3 Days (2 adults)", deckSize: null }];
    const html = await render();
    expect(html).toMatch(/<a class="res-btn white" href="https:\/\/cdn\/guide.pdf"[^>]*>.*Download guide/s);
    expect(html).toMatch(/<a class="res-btn ghost" href="https:\/\/cdn\/video.mp4"[^>]*>.*Watch assembly video/s);
    expect(html).not.toContain("aria-disabled=\"true\">" + "<svg");
    expect(html).toMatch(/<a class="res-item" href="https:\/\/cdn\/full.pdf"[^>]*>.*Installation Guide.*<span class="res-tag">24 pgs<\/span>/s);
    expect(html).toContain("<span>Estimated build</span><b>2 - 3 Days (2 adults)</b>");
  });
});
