// Gorgias helpdesk (REST API) for Help & Support: the customer's tickets and new requests.
// Auth is HTTP Basic — Gorgias account email as username, API key as password — against
// https://<GORGIAS_DOMAIN>.gorgias.com/api/. Reference: https://developers.gorgias.com/reference
import { ticketSubject, ticketTags, type Topic } from "./support";

/** Address customers write to; agents' replies go out from the matching Gorgias email integration. */
export const SUPPORT_EMAIL = "support@a-diy.com";
const TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 20000;

/** Thrown for any Gorgias failure; `message` is safe to show the customer. */
export class GorgiasError extends Error {}

function config() {
  const domain = process.env.GORGIAS_DOMAIN?.trim().replace(/\.gorgias\.com.*$/, "").replace(/^https?:\/\//, "");
  const email = process.env.GORGIAS_EMAIL?.trim();
  const key = process.env.GORGIAS_API_KEY?.trim();
  if (!domain || !email || !key) return null;
  return {
    api: `https://${domain}.gorgias.com/api`,
    auth: `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}`,
  };
}

export const gorgiasConfigured = () => config() !== null;

async function gorgias<T>(path: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
  const cfg = config();
  if (!cfg) throw new GorgiasError("Support requests aren't available right now.");
  const headers = new Headers(init.headers);
  headers.set("authorization", cfg.auth);
  headers.set("accept", "application/json");
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${cfg.api}${path}`, { ...init, headers, signal: AbortSignal.timeout(init.timeout ?? TIMEOUT_MS) });
  } catch (e) {
    console.error("[gorgias]", init.method ?? "GET", path.split("?")[0], e);
    throw new GorgiasError("Our help desk didn't respond — please try again in a moment.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[gorgias]", init.method ?? "GET", path.split("?")[0], res.status, detail.slice(0, 500));
    throw new GorgiasError(
      res.status === 429 ? "Our help desk is busy — please try again in a minute." : "We couldn't reach our help desk — please try again.",
    );
  }
  return (await res.json()) as T;
}

interface GorgiasCustomer {
  id: number;
  email: string | null;
}
// Docs show GET /api/customers returning a bare array; other list endpoints wrap results in `data`.
type List<T> = T[] | { data: T[] };
const items = <T>(l: List<T>) => (Array.isArray(l) ? l : (l?.data ?? []));

/** GET /api/customers?email= — https://developers.gorgias.com/reference/list-customers */
async function findCustomer(email: string) {
  const list = await gorgias<List<GorgiasCustomer>>(`/customers?${new URLSearchParams({ email, limit: "1" })}`);
  return items(list).find((c) => c.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

/**
 * The Gorgias customer for this email, created if new.
 * POST /api/customers — https://developers.gorgias.com/reference/create-customer
 * (`channels` is required: one email channel marked preferred).
 */
export async function findOrCreateCustomer(email: string, name: string | null) {
  const existing = await findCustomer(email);
  if (existing) return existing.id;
  const created = await gorgias<GorgiasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify({
      email,
      name: name || null,
      channels: [{ type: "email", address: email, preferred: true }],
    }),
  });
  return created.id;
}

export interface SupportTicket {
  id: number;
  subject: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

interface RawTicket {
  id: number;
  subject: string | null;
  status: string;
  created_datetime: string;
  updated_datetime: string | null;
  last_message_datetime: string | null;
  trashed_datetime: string | null;
  spam?: boolean;
  customer: { id: number } | null;
}

/**
 * The customer's tickets, most recently updated first. Doesn't create a Gorgias customer.
 * GET /api/tickets?customer_id= — https://developers.gorgias.com/reference/list-tickets
 * (`trashed` defaults to true, i.e. trashed tickets are included unless we pass false.)
 */
export async function listTickets(email: string): Promise<SupportTicket[]> {
  const customer = await findCustomer(email);
  if (!customer) return [];
  const qs = new URLSearchParams({
    customer_id: String(customer.id),
    order_by: "updated_datetime:desc",
    limit: "20",
    trashed: "false",
  });
  const list = await gorgias<List<RawTicket>>(`/tickets?${qs}`);
  return items(list)
    .filter((t) => t.customer?.id === customer.id && !t.trashed_datetime && !t.spam)
    .map((t) => ({
      id: t.id,
      subject: t.subject || "Support request",
      status: t.status === "closed" ? "closed" : "open",
      createdAt: t.created_datetime,
      updatedAt: t.updated_datetime ?? t.created_datetime,
      lastMessageAt: t.last_message_datetime,
    }));
}

export interface UploadedFile {
  url: string;
  name: string;
  size: number;
  content_type: string;
}

/**
 * Uploads one file as a private ticket attachment.
 * POST /api/upload?type=attachment, multipart/form-data — https://developers.gorgias.com/reference/post_api-upload
 * The form field name becomes the file's label; responds 201 with an array of
 * { content_type, name, size, url } (the docs' example has `size` as a string).
 */
export async function uploadAttachment(bytes: Uint8Array, name: string, contentType: string): Promise<UploadedFile> {
  const form = new FormData();
  form.append(name, new Blob([bytes.slice()], { type: contentType }), name);
  const [file] = await gorgias<UploadedFile[]>("/upload?type=attachment", { method: "POST", body: form, timeout: UPLOAD_TIMEOUT_MS });
  if (!file?.url) throw new GorgiasError("We couldn't attach your photos — please try again.");
  return { url: file.url, name: file.name || name, size: Number(file.size) || bytes.length, content_type: file.content_type || contentType };
}

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Opens a ticket as if the customer had emailed support@: an inbound (from_agent: false) email
 * message from the customer, so agents can reply by email from Gorgias.
 * POST /api/tickets — https://developers.gorgias.com/reference/create-ticket
 * (message requires `channel` + `from_agent`; tags are objects `{ name }`; attachments need
 * url, name, content_type.)
 */
export async function createTicket({
  email,
  name,
  topic,
  orderName,
  orderId,
  message,
  attachments,
}: {
  email: string;
  name: string | null;
  topic: Topic;
  orderName: string | null;
  orderId: string | null;
  message: string;
  attachments: UploadedFile[];
}) {
  const customerId = await findOrCreateCustomer(email, name);
  const subject = ticketSubject(topic, orderName);
  const intro = orderName ? `Order: ${orderName}\n\n` : "";
  const bodyText = `${intro}${message}\n\n— Sent from the A-DIY Hub`;
  const bodyHtml = `${orderName ? `<p><strong>Order:</strong> ${html(orderName)}</p>` : ""}${message
    .split(/\n{2,}/)
    .map((p) => `<p>${html(p).replace(/\n/g, "<br>")}</p>`)
    .join("")}<p style="color:#888">Sent from the A-DIY Hub</p>`;

  const ticket = await gorgias<{ id: number }>("/tickets", {
    method: "POST",
    body: JSON.stringify({
      customer: { id: customerId, email },
      channel: "email",
      via: "api",
      from_agent: false,
      status: "open",
      subject,
      tags: ticketTags(topic).map((t) => ({ name: t })),
      meta: { source: "a-diy-hub", topic, ...(orderId ? { shopify_order_id: orderId, shopify_order_name: orderName } : {}) },
      messages: [
        {
          channel: "email",
          via: "api",
          from_agent: false,
          sender: { email, ...(name ? { name } : {}) },
          receiver: { email: SUPPORT_EMAIL },
          subject,
          body_text: bodyText,
          body_html: bodyHtml,
          attachments,
        },
      ],
    }),
  });
  return ticket.id;
}
