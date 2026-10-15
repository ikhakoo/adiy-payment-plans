// The Help & Support POST action end to end, with the hub context, orders and Gorgias's HTTP API mocked:
// a valid request from the storefront becomes a Gorgias ticket; bad input never reaches Gorgias.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shopify.server", () => ({ authenticate: {} }));
vi.mock("../db.server", () => ({ default: {} }));
vi.mock("./hub.server", async (orig) => ({
  ...((await orig()) as object),
  hubContext: async () => ({
    page: null,
    ctx: { admin: {}, shop: "a-diy.myshopify.com", email: "ann@example.com", customerName: "Ann Lee" },
  }),
}));
vi.mock("./portal.server", async (orig) => ({
  ...((await orig()) as object),
  storefrontHosts: async () => ["a-diy.com", "www.a-diy.com"],
}));
vi.mock("./orders.server", async (orig) => ({
  ...((await orig()) as object),
  hubOrders: async () => [{ numericId: "111", name: "#1042" }],
}));

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");
const calls: { method: string; url: string; body: unknown }[] = [];
const realFetch = globalThis.fetch;

const post = async (body: unknown, origin = "https://a-diy.com") => {
  const { action } = await import("../routes/proxy.support");
  const res = await action({
    request: new Request("https://app.example/proxy/support", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never);
  return { status: res.status, json: (await res.json()) as { ok: boolean; message: string } };
};

describe("support request action", () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.GORGIAS_DOMAIN = "adiy";
    process.env.GORGIAS_EMAIL = "api@a-diy.com";
    process.env.GORGIAS_API_KEY = "k";
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
      if (url.includes("/customers?")) return Response.json([{ id: 5, email: "ann@example.com" }]);
      if (url.includes("/upload")) return Response.json([{ url: "https://files/p.jpg", name: "p.jpg", size: 8, content_type: "image/jpeg" }], { status: 201 });
      if (url.endsWith("/tickets")) return Response.json({ id: 77 }, { status: 201 });
      return Response.json({}, { status: 404 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.GORGIAS_DOMAIN;
    delete process.env.GORGIAS_EMAIL;
    delete process.env.GORGIAS_API_KEY;
  });

  it("opens a Gorgias ticket for the signed-in customer's order, with photos", async () => {
    const { status, json } = await post({ topic: "parts", orderId: "111", message: "Two joists arrived cracked.", photos: [{ name: "p.jpg", data: JPEG }] });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, message: "Thanks! Your request is in. We'll reply by email to ann@example.com." });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://adiy.gorgias.com/api/upload?type=attachment",
      "GET https://adiy.gorgias.com/api/customers?email=ann%40example.com&limit=1",
      "POST https://adiy.gorgias.com/api/tickets",
    ]);
    const ticket = calls[2].body as { customer: unknown; subject: string; meta: unknown; messages: { attachments: unknown[]; body_text: string }[] };
    expect(ticket.customer).toEqual({ id: 5, email: "ann@example.com" });
    expect(ticket.subject).toBe("Missing or damaged parts · Order #1042");
    expect(ticket.meta).toMatchObject({ topic: "parts", shopify_order_id: "111", shopify_order_name: "#1042" });
    expect(ticket.messages[0].attachments).toHaveLength(1);
    expect(ticket.messages[0].body_text).toContain("Two joists arrived cracked.");
  });

  it("rejects someone else's order, other origins, and works out when Gorgias isn't set up", async () => {
    expect((await post({ topic: "order", orderId: "999", message: "Where is my deck please?" })).json.ok).toBe(false);
    expect((await post({ topic: "rewards", message: "Gift card question" }, "https://evil.example")).status).toBe(403);
    expect(calls).toEqual([]);
    delete process.env.GORGIAS_API_KEY;
    const off = await post({ topic: "rewards", message: "Gift card question" });
    expect(off.status).toBe(503);
    expect(off.json.message).toMatch(/call .*or email support@a-diy.com/);
  });
});
