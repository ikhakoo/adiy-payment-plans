import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { esc, storefrontHosts } from "../lib/portal.server";
import { ARROW, asset, hubContext, icon, renderHub } from "../lib/hub.server";
import { fmtDay, hubOrders, mainLine, type HubOrder } from "../lib/orders.server";
import { createTicket, gorgiasConfigured, GorgiasError, listTickets, uploadAttachment, type SupportTicket } from "../lib/gorgias.server";
import { isTopic, parseSupportRequest, SUPPORT_LIMITS, TOPICS, type Topic } from "../lib/support";

const PHONE = "(786) 358-2872";
const TEL = "tel:+17863582872";
const EMAIL = "support@a-diy.com";

const ICON = {
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  compass: '<path d="m12.99 6.74 1.93 3.44M19.14 12a10 10 0 0 1-14.27 0M21 21l-2.16-3.84M3 21l8.02-14.26"/><circle cx="12" cy="5" r="2"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
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

  // A topic that opens the request form with itself preselected (works without JS via ?topic=).
  const requestHref = (t: Topic) => `${ctx.url("/support")}?topic=${t}${order ? `&order=${order.numericId}` : ""}#new-request`;
  const topicCard = (n: number, tile: string, title: string, text: string, href: string, cta: string, note: string, formTopic?: Topic) => `
    <div class="sup-topic">
      <div class="sup-topic-top"><span class="sup-cap">Topic 0${n}</span><span class="sup-tile">${icon(tile)}</span></div>
      <h2>${title}</h2>
      <p>${text}</p>
      <div class="sup-topic-foot">
        <a class="sup-cta" href="${esc(href)}"${formTopic ? ` data-sup-topic="${formTopic}"` : ""}>${cta} ${ARROW}</a>
        <span class="sup-note">${note}</span>
      </div>
    </div>`;

  const topics = `
    <section class="sup-topics">
      ${topicCard(1, ICON.truck, "Order &amp; delivery", "Questions about your order or delivery? Find answers and get in touch with our team.", requestHref("order"), "View delivery help", "EST. 2H REPLY", "order")}
      ${topicCard(2, ICON.compass, "Assembly help", "Find your installation guide, footing plan, and help with your next assembly step.", ctx.url("/resources"), "View build resources", "LIVE CAD ACCESS")}
      ${topicCard(3, ICON.archive, "Missing or damaged parts", "Send your order number, photos, and a short description of what's missing or damaged.", requestHref("parts"), "Report an issue", "PRIORITY ROUTE", "parts")}
      ${topicCard(4, ICON.gift, "Rewards help", "Get help with your submissions, reward balance, or Amazon gift cards.", ctx.url("/rewards/submissions"), "Check submission status", "AUTOMATED AUDIT")}
    </section>`;

  // Gorgias tickets: open ones by default, closed ones behind the filter button. Without Gorgias
  // (or with no tickets) this is the design's empty state.
  const list = tickets ?? [];
  const open = list.filter((t) => t.status === "open");
  const ticketRow = (t: SupportTicket) => `<li class="sup-ticket${t.status === "open" ? "" : " closed"}">
      <div>
        <b>${esc(t.subject)}</b>
        <span>Request #${esc(t.id)} · Updated ${fmtDay(t.lastMessageAt ?? t.updatedAt)}</span>
      </div>
      ${t.status === "open" ? `<span class="pill gold dot">Open</span>` : `<span class="pill ok">Closed</span>`}
    </li>`;
  const stepper = `<a class="sup-stepper" href="#new-request">
      <b>New request</b>${icon(ICON.chev)}<span>Choose a topic</span>${icon(ICON.chev)}<span>Select your order</span>${icon(ICON.chev)}<span>Add details &amp; photos</span>
    </a>`;
  const requests = `
    <section class="sup-card sup-reqs" data-view="open">
      <div class="sup-reqs-head">
        <div><span class="sup-cap">Active audit records</span><h2>Your support requests</h2></div>
        <button type="button" class="sup-filter" data-sup-filter data-open="${open.length}" data-all="${list.length}"${list.length > open.length ? "" : " disabled"}>Filtered: Open Tickets (${open.length})</button>
      </div>
      <div class="sup-box">
        ${list.length ? `<ul class="sup-tickets">${list.map(ticketRow).join("")}</ul>` : ""}
        <div class="sup-empty${list.length > open.length ? " has-closed" : ""}"${open.length ? " hidden" : ""}>
          <span class="sup-empty-ico">${icon(ICON.inbox)}</span>
          <div><p>You have no open requests.</p><span>Need a hand? Start a request and tell us how we can help.</span></div>
        </div>
        ${stepper}
        ${list.length ? `<p class="sup-replies">We reply by email to ${esc(ctx.email)}.</p>` : ""}
      </div>
    </section>`;

  const topicOptions = (Object.keys(TOPICS) as Topic[])
    .map((k) => `<label class="sp-choice"><input type="radio" name="topic" value="${k}"${k === topic ? " checked" : ""}><span>${TOPICS[k].label}</span></label>`)
    .join("");
  const orderOptions = orders
    .map((o) => `<option value="${esc(o.numericId)}"${o.id === order?.id ? " selected" : ""}>${esc(orderLabel(o))}</option>`)
    .join("");

  // Without Gorgias the same form still works: sending it opens the customer's email app with the
  // request written out to support@ (photos can't travel in a mailto link, so they attach them there).
  const form = `
    <section class="sup-card" id="new-request">
      <div class="sup-form-head"><span class="sup-cap">New request</span><h2>Tell us how we can help</h2>
        <p>${configured ? "Tell us what's going on and we'll get back to you by email, usually within one business day." : "Follow the three steps below and we'll get back to you by email, usually within one business day."}</p></div>
      ${
        configured
          ? ""
          : `<div class="notice warn sup-offline"><strong>Online requests are being set up.</strong> For now, “Email your request” opens your email app with everything you fill in below, addressed to <a href="mailto:${EMAIL}">${EMAIL}</a> — just press send, and attach any photos there. Or call us at <a href="${TEL}">${PHONE}</a>.</div>`
      }
      <form id="sp-form" class="sp-form" novalidate data-config="${esc(
        JSON.stringify({
          action: ctx.url("/support"),
          focus: !!(topic || order),
          mailto: configured ? null : EMAIL,
          labels: Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [k, v.label])),
          orderNames: Object.fromEntries(orders.map((o) => [o.numericId, o.name])),
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
              ? `<select name="orderId" id="sp-order">
                   <option value="">Not about a specific order</option>${orderOptions}
                 </select>`
              : `<p class="muted" style="margin:0">We couldn't find any orders on your account. If your question is about an order, include its number in your message.</p>`
          }
        </fieldset>
        <fieldset class="sp-step">
          <legend><i>3</i>Add details &amp; photos</legend>
          <label class="field" for="sp-message">What can we help with?
            <textarea id="sp-message" name="message" rows="5" maxlength="${SUPPORT_LIMITS.messageMax}" required
              placeholder="For missing or damaged parts, tell us which parts and how many."></textarea>
          </label>
          ${
            configured
              ? `<label class="drop sp-drop">
                   <input type="file" id="sp-photos" accept="image/*" multiple>
                   <span class="btn light">Add photos</span>
                   <span class="muted">Up to ${SUPPORT_LIMITS.photos} photos. Clear shots of labels, parts or damage help us most.</span>
                 </label>
                 <ul class="sp-thumbs" id="sp-thumbs"></ul>`
              : `<p class="muted sup-photo-note">Photos help us most with missing or damaged parts: attach them to the email that opens when you send this.</p>`
          }
        </fieldset>
        <div class="notice warn" id="sp-msg" role="alert" style="display:none"></div>
        <div class="btn-row">
          <button class="btn" type="submit" id="sp-submit">${configured ? "Send request" : "Email your request"} ${ARROW}</button>
        </div>
      </form>
    </section>`;

  const desk = `
    <section class="sup-desk">
      <div class="sup-desk-cap"><i></i>Direct specialist desk</div>
      <h2>Prefer to talk it through?</h2>
      <p>Call us at <a href="${TEL}">${PHONE}</a> or email <a href="mailto:${EMAIL}">${EMAIL}</a>. Our Deck Specialists are here to help.</p>
      <div class="sup-desk-foot">
        <a class="sup-call" href="${TEL}">${icon(ICON.phone)}Call us</a>
        <a class="sup-mail" href="mailto:${EMAIL}">${icon(ICON.mail)}Email us</a>
        <span class="sup-hold">Avg. Hold: &lt; 90 seconds</span>
      </div>
    </section>`;

  const body = `
    <div class="sup-page">
      <div class="sup-head">
        <h1>Need help? We're here for you.</h1>
        <p>Get help with your order, delivery, assembly, or rewards.</p>
      </div>
      ${topics}
      ${requests}
      ${form}
      ${desk}
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
