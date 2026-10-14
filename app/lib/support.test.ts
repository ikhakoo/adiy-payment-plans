import { describe, expect, it } from "vitest";
import { parseSupportRequest, sniffImage, SUPPORT_LIMITS, ticketSubject, ticketTags } from "./support";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]).toString("base64");
const base = { topic: "parts", orderId: "111", message: "Two joists arrived cracked." };

describe("parseSupportRequest", () => {
  it("accepts a valid request with photos", () => {
    const r = parseSupportRequest({ ...base, photos: [{ name: "a.heic", data: `data:image/jpeg;base64,${JPEG}` }, { name: "b", data: PNG }] }, ["111"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.orderId).toBe("111");
    expect(r.value.photos.map((p) => [p.name, p.contentType])).toEqual([["a.jpg", "image/jpeg"], ["b.png", "image/png"]]);
  });

  it("rejects an order that isn't the customer's", () => {
    expect(parseSupportRequest({ ...base, orderId: "999" }, ["111"])).toEqual({ ok: false, message: expect.stringMatching(/couldn't find/) });
  });

  it("needs an order for order topics but not for rewards", () => {
    expect(parseSupportRequest({ ...base, orderId: "" }, ["111"]).ok).toBe(false);
    expect(parseSupportRequest({ ...base, topic: "rewards", orderId: "" }, ["111"]).ok).toBe(true);
    // A customer with no orders can still ask about anything.
    expect(parseSupportRequest({ ...base, orderId: "" }, []).ok).toBe(true);
  });

  it("rejects unknown topics, short messages and too many photos", () => {
    expect(parseSupportRequest({ ...base, topic: "toString" }, ["111"]).ok).toBe(false);
    expect(parseSupportRequest({ ...base, message: "help" }, ["111"]).ok).toBe(false);
    const photos = Array.from({ length: SUPPORT_LIMITS.photos + 1 }, () => ({ name: "x", data: JPEG }));
    expect(parseSupportRequest({ ...base, photos }, ["111"]).ok).toBe(false);
  });

  it("rejects files that aren't images, whatever they're called", () => {
    const pdf = Buffer.from("%PDF-1.4 hello").toString("base64");
    expect(parseSupportRequest({ ...base, photos: [{ name: "x.jpg", data: pdf }] }, ["111"]).ok).toBe(false);
  });

  it("rejects oversize photos", () => {
    const big = Buffer.alloc(SUPPORT_LIMITS.photoBytes + 10, 0xff).toString("base64");
    expect(parseSupportRequest({ ...base, photos: [{ name: "x", data: big }] }, ["111"]).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("builds subjects and tags", () => {
    expect(ticketSubject("parts", "#1234")).toBe("Missing or damaged parts · Order #1234");
    expect(ticketSubject("rewards", null)).toBe("Rewards help");
    expect(ticketTags("order")).toEqual(["hub", "hub-order"]);
  });
  it("sniffs webp", () => {
    expect(sniffImage(new Uint8Array(Buffer.from("RIFF0000WEBPVP8 ")))).toBe("image/webp");
  });
});

describe("gorgias client", () => {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const reply = (url: string, method: string): unknown => {
    if (url.includes("/customers?")) return [];
    if (url.endsWith("/customers")) return { id: 42 };
    if (url.includes("/upload")) return [{ url: "https://files/x.jpg", name: "x.jpg", size: "12", content_type: "image/jpeg" }];
    if (url.endsWith("/tickets") && method === "POST") return { id: 7 };
    return { data: [] };
  };

  it("creates the customer, uploads photos and opens a tagged ticket", async () => {
    process.env.GORGIAS_DOMAIN = "adiy";
    process.env.GORGIAS_EMAIL = "api@a-diy.com";
    process.env.GORGIAS_API_KEY = "k";
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      expect(new Headers(init.headers).get("authorization")).toBe(`Basic ${Buffer.from("api@a-diy.com:k").toString("base64")}`);
      calls.push({ method, url, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
      return Response.json(reply(url, method), { status: method === "POST" ? 201 : 200 });
    }) as typeof fetch;
    try {
      const g = await import("./gorgias.server");
      expect(g.gorgiasConfigured()).toBe(true);
      const file = await g.uploadAttachment(new Uint8Array([0xff, 0xd8, 0xff]), "x.jpg", "image/jpeg");
      expect(file).toEqual({ url: "https://files/x.jpg", name: "x.jpg", size: 12, content_type: "image/jpeg" });
      await g.createTicket({ email: "a@b.com", name: "Ann", topic: "parts", orderName: "#1234", orderId: "1", message: "Hi <there>", attachments: [file] });
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
        "POST https://adiy.gorgias.com/api/upload?type=attachment",
        "GET https://adiy.gorgias.com/api/customers?email=a%40b.com&limit=1",
        "POST https://adiy.gorgias.com/api/customers",
        "POST https://adiy.gorgias.com/api/tickets",
      ]);
      const ticket = calls[3].body as {
        customer: unknown;
        subject: string;
        tags: unknown;
        messages: { body_html: string }[];
      };
      expect(ticket.customer).toEqual({ id: 42, email: "a@b.com" });
      expect(ticket.subject).toBe("Missing or damaged parts · Order #1234");
      expect(ticket.tags).toEqual([{ name: "hub" }, { name: "hub-parts" }]);
      expect(ticket.messages[0]).toMatchObject({ channel: "email", from_agent: false, sender: { email: "a@b.com", name: "Ann" }, attachments: [file] });
      expect(ticket.messages[0].body_html).toContain("Hi &lt;there&gt;");
    } finally {
      globalThis.fetch = orig;
      delete process.env.GORGIAS_DOMAIN;
    }
  });
});
