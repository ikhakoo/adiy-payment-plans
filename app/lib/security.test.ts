import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../shopify.server", () => ({ authenticate: {} }));

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = "test-secret";
});

describe("encrypt / decrypt", () => {
  it("round-trips and doesn't store the plain text", async () => {
    const { encrypt, decrypt } = await import("./crypto.server");
    const sealed = encrypt("1//refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(decrypt(sealed)).toBe("1//refresh-token");
  });

  it("rejects tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("./crypto.server");
    const [iv, tag, data] = encrypt("secret").split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });
});

describe("OAuth state", () => {
  it("verifies its own signature", async () => {
    const { signState, verifyState } = await import("./crypto.server");
    expect(verifyState(signState({ shop: "a.myshopify.com" }))?.shop).toBe("a.myshopify.com");
  });

  it("rejects a forged shop", async () => {
    const { signState, verifyState } = await import("./crypto.server");
    const [, sig] = signState({ shop: "a.myshopify.com" }).split(".");
    const forged = Buffer.from(JSON.stringify({ shop: "evil.myshopify.com", exp: Date.now() + 60_000 })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`)).toBeNull();
  });

  it("expires", async () => {
    const { signState, verifyState } = await import("./crypto.server");
    expect(verifyState(signState({ shop: "a" }, -1))).toBeNull();
  });
});

describe("esc (portal pages are Liquid)", () => {
  it("neutralises HTML and Liquid delimiters", async () => {
    const { esc } = await import("./portal.server");
    const out = esc(`<script>{{ shop.email }}{% if x %}</script>`);
    expect(out).not.toMatch(/[<>{}]/);
    expect(out).toContain("&#123;&#123;");
  });
});
