import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { esc, storefrontHosts } from "../lib/portal.server";
import { ARROW, asset, hubContext, icon, renderHub } from "../lib/hub.server";
import { fmtDay, hubOrders, mainLine, type HubOrder } from "../lib/orders.server";
import { createTicket, gorgiasConfigured, GorgiasError, listTickets, uploadAttachment, type SupportTicket } from "../lib/gorgias.server";
import { isTopic, parseSupportRequest, SUPPORT_LIMITS, TOPICS } from "../lib/support";

const PHONE = "(786) 358-2872";
const TEL = "tel:+17863582872";
const EMAIL = "support@a-diy.com";

const ICON = {
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};

const orderLabel = (o: HubOrder) => {
  const line = mainLine(o);
  return `${o.name}${line ? ` · ${line.title}` : ""} · ${fmtDay(o.createdAt)}`;
};

// GET /apps/hub/support — Help & Support: topic shortcuts, the customer's Gorgias tickets, and a
// new-request form. Honours ?topic=<topic>&order=<numeric order id> (e.g. "Report an issue" links).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;

  const params = new URL(request.url).searchParams;
  const configured = gorgiasConfigured();
  const [orders, tickets] = await Promise.all([
    hubOrders(ctx).catch((e) => {
      console.error("[proxy/support] orders", e);
      return [] as HubOrder[];
    }),
    configured && ctx.email
      ? listTickets(ctx.email).catch((e) => {
          if (!(e instanceof GorgiasError)) console.error("[proxy/support] tickets", e);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const wantTopic = params.get("topic");
  const topic = isTopic(wantTopic) ? wantTopic : null;
  const wantOrder = params.get("order")?.replace(/\D/g, "") ?? "";
  const order = orders.find((o) => o.numericId === wantOrder) ?? null;

  const topicCard = (n: number, tile: string, title: string, text: string, href: string, cta: string) => `
    <div class="card sp-topic">
      <div class="card-head">
        <div class="icon-tile" style="margin:0">${icon(tile)}</div>
        <span class="label">Topic 0${n}</span>
      </div>
      <h2 class="h3">${title}</h2>
      <p class="muted" style="font-size:14px">${text}</p>
      <div class="spacer"></div>
      <div><a class="btn light" href="${esc(href)}">${cta} ${ARROW}</a></div>
    </div>`;

  const topics = `
    <div class="grid2">
      ${topicCard(1, ICON.truck, "Order &amp; delivery", "Questions about your order or delivery? Find answers and get in touch with our team.", ctx.url("/track"), "View delivery help")}
      ${topicCard(2, ICON.tools, "Assembly help", "Find your installation guide, footing plan, and help with your next assembly step.", ctx.url("/resources"), "View build resources")}
    </div>
    <div class="grid2">
      ${topicCard(3, ICON.box, "Missing or damaged parts", "Send your order number, photos, and a short description of what's missing or damaged.", `${ctx.url("/support")}?topic=parts${order ? `&order=${order.numericId}` : ""}#new-request`, "Report an issue")}
      ${topicCard(4, ICON.gift, "Rewards help", "Get help with your submissions, reward balance, or Amazon gift cards.", ctx.url("/rewards/submissions"), "Check submission status")}
    </div>`;

  const ticketRow = (t: SupportTicket) => `<li>
      <div>
        <div class="h3" style="font-size:15px">${esc(t.subject)}</div>
        <div class="muted">Request #${esc(t.id)} · Updated ${fmtDay(t.lastMessageAt ?? t.updatedAt)}</div>
      </div>
      ${t.status === "open" ? `<span class="pill gold dot">Open</span>` : `<span class="pill ok">Closed</span>`}
    </li>`;
  const requests =
    tickets === null
      ? ""
      : tickets.length
        ? `<div class="card"><div class="card-head"><h2 class="h2">Your support requests</h2>
             <span class="pill">${tickets.filter((t) => t.status === "open").length} open</span></div>
             <ul class="rows">${tickets.map(ticketRow).join("")}</ul>
             <p class="muted" style="margin:12px 0 0">We reply by email to ${esc(ctx.email)}.</p></div>`
        : `<div class="card sp-empty">
             <div class="icon-tile">${icon(ICON.inbox)}</div>
             <h2 class="h2">Your support requests</h2>
             <p class="h3" style="margin-top:8px">You have no open requests.</p>
             <p class="muted">Need a hand? Start a request and tell us how we can help.</p>
             <a class="btn" href="#new-request">Start a request</a>
           </div>`;

  const topicOptions = (Object.keys(TOPICS) as (keyof typeof TOPICS)[])
    .map(
      (k) => `<label class="sp-choice"><input type="radio" name="topic" value="${k}"${k === topic ? " checked" : ""}${configured ? "" : " disabled"}><span>${TOPICS[k].label}</span></label>`,
    )
    .join("");
  const orderOptions = orders
    .map((o) => `<option value="${esc(o.numericId)}"${o.id === order?.id ? " selected" : ""}>${esc(orderLabel(o))}</option>`)
    .join("");

  const form = `
    <div class="card" id="new-request">
      <div class="card-head"><div><h2 class="h2">New request</h2>
        <p class="muted" style="margin:0">Tell us what's going on and we'll get back to you by email, usually within one business day.</p></div></div>
      ${
        configured
          ? ""
          : `<div class="notice warn"><strong>Online requests aren't available right now.</strong> Please call us at <a href="${TEL}">${PHONE}</a> or email <a href="mailto:${EMAIL}">${EMAIL}</a> and we'll help you straight away.</div>`
      }
      <form id="sp-form" class="sp-form" novalidate data-config="${esc(
        JSON.stringify({
          action: ctx.url("/support"),
          focus: !!(topic || order),
          maxPhotos: SUPPORT_LIMITS.photos,
          maxTotal: SUPPORT_LIMITS.totalBytes,
          maxPhoto: SUPPORT_LIMITS.photoBytes,
          minMessage: SUPPORT_LIMITS.messageMin,
          needsOrder: Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [k, v.needsOrder && orders.length > 0])),
        }),
      )}">
        <fieldset class="sp-step">
          <legend><i>1</i>Choose a topic</legend>
          <div class="sp-choices">${topicOptions}</div>
        </fieldset>
        <fieldset class="sp-step">
          <legend><i>2</i>Select your order <small id="sp-order-hint">${topic && !TOPICS[topic].needsOrder ? "Optional" : ""}</small></legend>
          ${
            orders.length
              ? `<select name="orderId" id="sp-order"${configured ? "" : " disabled"}>
                   <option value="">Not about a specific order</option>${orderOptions}
                 </select>`
              : `<p class="muted" style="margin:0">We couldn't find any orders on your account. If your question is about an order, include its number in your message.</p>`
          }
        </fieldset>
        <fieldset class="sp-step">
          <legend><i>3</i>Add details &amp; photos</legend>
          <label class="field" for="sp-message">What can we help with?
            <textarea id="sp-message" name="message" rows="5" maxlength="${SUPPORT_LIMITS.messageMax}" required${configured ? "" : " disabled"}
              placeholder="For missing or damaged parts, tell us which parts and how many."></textarea>
          </label>
          <label class="drop sp-drop${configured ? "" : " disabled"}">
            <input type="file" id="sp-photos" accept="image/*" multiple${configured ? "" : " disabled"}>
            <span class="btn light">Add photos</span>
            <span class="muted">Up to ${SUPPORT_LIMITS.photos} photos. Clear shots of labels, parts or damage help us most.</span>
          </label>
          <ul class="sp-thumbs" id="sp-thumbs"></ul>
        </fieldset>
        <div class="notice warn" id="sp-msg" role="alert" style="display:none"></div>
        <div class="btn-row">
          <button class="btn" type="submit" id="sp-submit"${configured ? "" : " disabled"}>Send request ${ARROW}</button>
        </div>
      </form>
    </div>`;

  const desk = `
    <div class="card sp-desk">
      <div class="icon-tile">${icon(ICON.phone)}</div>
      <div class="eyebrow" style="color:var(--gold)">Direct specialist desk</div>
      <h2 class="h2">Prefer to talk it through?</h2>
      <p>Call us at <a href="${TEL}">${PHONE}</a> or email <a href="mailto:${EMAIL}">${EMAIL}</a>. Our Deck Specialists are here to help.</p>
      <div class="btn-row">
        <a class="btn white" href="${TEL}">Call us</a>
        <a class="btn white" href="mailto:${EMAIL}">Email us</a>
        <a class="btn white" href="#new-request" data-hub-chat>Chat now</a>
      </div>
    </div>`;

  const body = `
    <div class="page-head">
      <div class="eyebrow">Help &amp; Support</div>
      <h1 class="h1">Need help? We're here for you.</h1>
      <p class="lede">Get help with your order, delivery, assembly, or rewards.</p>
    </div>
    ${topics}
    <div class="with-aside sp-layout">
      <div>${requests}${form}</div>
      <div>${desk}</div>
    </div>
    <script src="${asset("hub-support.js")}" defer></script>`;

  return renderHub(ctx, "support", "Help & Support", body);
};

// POST /apps/hub/support — sends a new request to Gorgias for the signed-in customer. Topic, order
// (must be one of their own), message and photos are re-validated here; nothing from the browser
// identifies the customer.
const fail = (message: string, status = 400) => Response.json({ ok: false, message }, { status });
const MAX_BODY = Math.ceil((SUPPORT_LIMITS.totalBytes * 4) / 3) + 64 * 1024;

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return fail("Not allowed.", 405);
  // JSON only: a cross-site form can't send it without a CORS preflight.
  if (!request.headers.get("content-type")?.includes("application/json")) return fail("Unsupported request.", 415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return fail("Your photos are too large — please send fewer.", 413);

  const { page, ctx } = await hubContext(request);
  if (page || !ctx) return fail("Please sign in again.", 401);
  if (!ctx.email) return fail("We couldn't find the email on your account.");
  if (!gorgiasConfigured()) return fail(`Online requests aren't available right now. Please call ${PHONE} or email ${EMAIL}.`, 503);

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return fail("Your photos are too large — please send fewer.", 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail("Something went wrong — please try again.");
  }

  try {
    // Same rule as uploads in proxy.api.tsx: requests must come from the storefront itself.
    const origin = request.headers.get("origin") || (typeof body.origin === "string" ? body.origin : "");
    const hosts = await storefrontHosts(ctx.admin, ctx.shop);
    if (!/^https:\/\//.test(origin) || !hosts.includes(new URL(origin).host)) {
      return fail("Requests have to come from the store's website.", 403);
    }

    const orders = await hubOrders(ctx);
    const parsed = parseSupportRequest(body, orders.map((o) => o.numericId));
    if (!parsed.ok) return fail(parsed.message);
    const { topic, orderId, message, photos } = parsed.value;
    const order = orders.find((o) => o.numericId === orderId) ?? null;

    const attachments = await Promise.all(photos.map((p) => uploadAttachment(p.bytes, p.name, p.contentType)));
    await createTicket({
      email: ctx.email,
      name: ctx.customerName,
      topic,
      orderName: order?.name ?? null,
      orderId: order?.numericId ?? null,
      message,
      attachments,
    });
    return Response.json({ ok: true, message: `Thanks! Your request is in. We'll reply by email to ${ctx.email}.` });
  } catch (e) {
    if (e instanceof GorgiasError) return fail(`${e.message} You can also call ${PHONE} or email ${EMAIL}.`, 502);
    console.error("[proxy/support] create", e);
    return fail(`Something went wrong — please try again, or call ${PHONE}.`, 500);
  }
};
