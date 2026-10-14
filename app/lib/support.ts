// Help & Support request rules, shared by the page and its POST action. Pure so they're unit-tested.

export const TOPICS = {
  order: { label: "Order & delivery", needsOrder: true },
  assembly: { label: "Assembly help", needsOrder: true },
  parts: { label: "Missing or damaged parts", needsOrder: true },
  rewards: { label: "Rewards help", needsOrder: false },
  other: { label: "Something else", needsOrder: false },
} as const;
export type Topic = keyof typeof TOPICS;
export const isTopic = (v: unknown): v is Topic => typeof v === "string" && Object.hasOwn(TOPICS, v);

export const SUPPORT_LIMITS = {
  messageMin: 10,
  messageMax: 5000,
  photos: 5,
  photoBytes: 3 * 1024 * 1024, // per photo, after the browser downscales it
  totalBytes: 8 * 1024 * 1024,
};
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface Photo {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}
export interface SupportRequest {
  topic: Topic;
  /** Numeric Shopify order id, already checked against the customer's own orders. */
  orderId: string | null;
  message: string;
  photos: Photo[];
}

/** Recognises the image by its first bytes, so a renamed file can't pass as a photo. */
export function sniffImage(b: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

const cleanName = (name: string, type: string) => {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const base = name.replace(/\.[^.]*$/, "").replace(/[^\w .-]+/g, "").trim().slice(0, 80) || "photo";
  return `${base}.${ext}`;
};

/**
 * Validates the browser's JSON body. `ownOrderIds` are the numeric ids of the signed-in
 * customer's orders: an order outside that list is rejected, never trusted.
 */
export function parseSupportRequest(
  body: Record<string, unknown>,
  ownOrderIds: string[],
): { ok: true; value: SupportRequest } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });

  if (!isTopic(body.topic)) return fail("Please choose a topic.");
  const topic = body.topic;

  const rawOrder = typeof body.orderId === "string" ? body.orderId.replace(/\D/g, "") : "";
  if (rawOrder && !ownOrderIds.includes(rawOrder)) return fail("We couldn't find that order on your account.");
  if (!rawOrder && TOPICS[topic].needsOrder && ownOrderIds.length) return fail("Please select your order.");

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < SUPPORT_LIMITS.messageMin) return fail("Please tell us a little more about how we can help.");
  if (message.length > SUPPORT_LIMITS.messageMax) {
    return fail(`Please keep your message under ${SUPPORT_LIMITS.messageMax.toLocaleString("en-US")} characters.`);
  }

  const raw = Array.isArray(body.photos) ? body.photos : [];
  if (raw.length > SUPPORT_LIMITS.photos) return fail(`You can add up to ${SUPPORT_LIMITS.photos} photos.`);
  const photos: Photo[] = [];
  let total = 0;
  for (const p of raw as Record<string, unknown>[]) {
    const data = typeof p?.data === "string" ? p.data.replace(/^data:[^,]*,/, "") : "";
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return fail("One of your photos couldn't be read — please try again.");
    // Cheap size check before decoding: 4 base64 characters carry 3 bytes.
    if ((data.length * 3) / 4 > SUPPORT_LIMITS.photoBytes + 3) return fail("One of your photos is too large.");
    const bytes = new Uint8Array(Buffer.from(data, "base64"));
    const type = sniffImage(bytes);
    if (!type) return fail("Photos must be JPEG, PNG or WebP images.");
    total += bytes.length;
    if (total > SUPPORT_LIMITS.totalBytes) return fail("Your photos are too large together — please send fewer.");
    photos.push({ name: cleanName(typeof p.name === "string" ? p.name : "", type), contentType: type, bytes });
  }

  return { ok: true, value: { topic, orderId: rawOrder || null, message, photos } };
}

/** "Missing or damaged parts · Order #1234" */
export const ticketSubject = (topic: Topic, orderName: string | null) =>
  `${TOPICS[topic].label}${orderName ? ` · Order ${orderName.startsWith("#") ? "" : "#"}${orderName}` : ""}`;

export const ticketTags = (topic: Topic) => ["hub", `hub-${topic}`];
