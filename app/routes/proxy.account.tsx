import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { esc } from "../lib/portal.server";
import { asset, hubContext, renderHub, type HubContext } from "../lib/hub.server";
import { hubOrders } from "../lib/orders.server";

const CUSTOMER = `#graphql
  query HubAccount($id: ID!) {
    customer(id: $id) {
      firstName
      lastName
      defaultEmailAddress { emailAddress }
      defaultPhoneNumber { phoneNumber }
      defaultAddress { id }
      addressesV2(first: 25) {
        nodes { id firstName lastName company address1 address2 city provinceCode zip countryCodeV2 phone }
      }
    }
  }`;

const CUSTOMER_UPDATE = `#graphql
  mutation HubCustomerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) { customer { id } userErrors { field message } }
  }`;
const ADDRESS_CREATE = `#graphql
  mutation HubAddressCreate($customerId: ID!, $address: MailingAddressInput!, $setAsDefault: Boolean) {
    customerAddressCreate(customerId: $customerId, address: $address, setAsDefault: $setAsDefault) {
      address { id }
      userErrors { field message }
    }
  }`;
const ADDRESS_UPDATE = `#graphql
  mutation HubAddressUpdate($customerId: ID!, $addressId: ID!, $address: MailingAddressInput!) {
    customerAddressUpdate(customerId: $customerId, addressId: $addressId, address: $address) {
      address { id }
      userErrors { field message }
    }
  }`;
const ADDRESS_DELETE = `#graphql
  mutation HubAddressDelete($customerId: ID!, $addressId: ID!) {
    customerAddressDelete(customerId: $customerId, addressId: $addressId) { deletedAddressId userErrors { field message } }
  }`;
const ADDRESS_DEFAULT = `#graphql
  mutation HubAddressDefault($customerId: ID!, $addressId: ID!) {
    customerUpdateDefaultAddress(customerId: $customerId, addressId: $addressId) { customer { id } userErrors { field message } }
  }`;

interface Address {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  zip: string | null;
  countryCodeV2: string | null;
  phone: string | null;
}
interface Customer {
  firstName: string | null;
  lastName: string | null;
  defaultEmailAddress: { emailAddress: string } | null;
  defaultPhoneNumber: { phoneNumber: string } | null;
  defaultAddress: { id: string } | null;
  addressesV2: { nodes: Address[] };
}
type UserError = { field: string[] | null; message: string };

async function loadCustomer(ctx: HubContext) {
  const res = await ctx.admin.graphql(CUSTOMER, { variables: { id: ctx.customerId } });
  const json = (await res.json()) as { data?: { customer: Customer | null } };
  return json.data?.customer ?? null;
}

const COUNTRIES: [string, string][] = [
  ["US", "United States"],
  ["CA", "Canada"],
];

// ---------------------------------------------------------------- page

function addressLines(a: Address) {
  return [
    [a.firstName, a.lastName].filter(Boolean).join(" "),
    a.company,
    a.address1,
    a.address2,
    [a.city, [a.provinceCode, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    a.countryCodeV2 && a.countryCodeV2 !== "US" ? (COUNTRIES.find(([c]) => c === a.countryCodeV2)?.[1] ?? a.countryCodeV2) : null,
    a.phone,
  ]
    .filter(Boolean)
    .map((l) => esc(l))
    .join("<br>");
}

const field = (label: string, name: string, value: string | null | undefined, attrs = "") =>
  `<label class="field">${label}<input type="text" name="${name}" value="${esc(value ?? "")}" ${attrs}></label>`;

function addressForm(a: Partial<Address> | null, intent: "address-create" | "address-update") {
  const country = a?.countryCodeV2 || "US";
  const countries = COUNTRIES.some(([c]) => c === country) ? COUNTRIES : [...COUNTRIES, [country, country]];
  return `<form class="acct-form" data-intent="${intent}"${a?.id ? ` data-id="${esc(a.id)}"` : ""} hidden novalidate>
      <div class="acct-grid">
        ${field("First name", "firstName", a?.firstName, 'autocomplete="given-name" required')}
        ${field("Last name", "lastName", a?.lastName, 'autocomplete="family-name" required')}
        <div class="acct-wide">${field("Company (optional)", "company", a?.company, 'autocomplete="organization"')}</div>
        <div class="acct-wide">${field("Address", "address1", a?.address1, 'autocomplete="address-line1" required')}</div>
        <div class="acct-wide">${field("Apartment, suite, etc. (optional)", "address2", a?.address2, 'autocomplete="address-line2"')}</div>
        ${field("City", "city", a?.city, 'autocomplete="address-level2" required')}
        ${field("State", "provinceCode", a?.provinceCode, 'autocomplete="address-level1" maxlength="3" placeholder="e.g. NJ" required')}
        ${field("ZIP code", "zip", a?.zip, 'autocomplete="postal-code" inputmode="numeric" required')}
        <label class="field">Country<select name="countryCode" autocomplete="country">${countries
          .map(([c, n]) => `<option value="${esc(c)}"${c === country ? " selected" : ""}>${esc(n)}</option>`)
          .join("")}</select></label>
        <div class="acct-wide"><label class="field">Phone (optional)<input type="tel" name="phone" value="${esc(a?.phone ?? "")}" autocomplete="tel"></label></div>
        ${intent === "address-create" ? `<label class="acct-check acct-wide"><input type="checkbox" name="setAsDefault"> Make this my default address</label>` : ""}
      </div>
      <p class="notice warn acct-msg" hidden></p>
      <div class="btn-row">
        <button class="btn" type="submit">${intent === "address-create" ? "Save address" : "Save changes"}</button>
        <button class="btn light" type="button" data-cancel>Cancel</button>
      </div>
    </form>`;
}

// GET /apps/hub/account — Account & Addresses: contact details, saved addresses, the active order's address.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { page, ctx } = await hubContext(request);
  if (page) return page;
  const [customer, orders] = await Promise.all([loadCustomer(ctx), hubOrders(ctx)]);
  const updated = new URL(request.url).searchParams.has("updated");

  const email = customer?.defaultEmailAddress?.emailAddress ?? ctx.email ?? "";
  const phone = customer?.defaultPhoneNumber?.phoneNumber ?? "";
  const fullName = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || ctx.customerName || "";
  const defaultId = customer?.defaultAddress?.id ?? null;
  // Default first, then the rest in Shopify's order.
  const addresses = [...(customer?.addressesV2.nodes ?? [])].sort((x, y) => Number(y.id === defaultId) - Number(x.id === defaultId));

  const personal = `
    <div class="card acct-block">
      <div class="card-head">
        <div><h2 class="h2">Personal information</h2><p class="muted" style="margin:0">Your contact details for order updates and support.</p></div>
        <button class="btn light" type="button" data-edit>Edit details</button>
      </div>
      <dl class="acct-view acct-dl">
        <div><dt class="label">Full name</dt><dd>${esc(fullName) || '<span class="muted">Not set</span>'}</dd></div>
        <div><dt class="label">Email</dt><dd>${esc(email)}</dd></div>
        <div><dt class="label">Phone</dt><dd>${esc(phone) || '<span class="muted">Not set</span>'}</dd></div>
      </dl>
      <form class="acct-form" data-intent="profile" hidden novalidate>
        <div class="acct-grid">
          ${field("First name", "firstName", customer?.firstName, 'autocomplete="given-name"')}
          ${field("Last name", "lastName", customer?.lastName, 'autocomplete="family-name"')}
          <label class="field">Email<input type="email" value="${esc(email)}" readonly disabled></label>
          <label class="field">Phone<input type="tel" name="phone" value="${esc(phone)}" autocomplete="tel" placeholder="(555) 555-0123"></label>
        </div>
        <p class="muted" style="margin:10px 0 0">Your email is how you sign in, so it can't be changed here. To use a different email, message us.</p>
        <p class="notice warn acct-msg" hidden></p>
        <div class="btn-row">
          <button class="btn" type="submit">Save changes</button>
          <button class="btn light" type="button" data-cancel>Cancel</button>
        </div>
      </form>
    </div>`;

  const list = addresses
    .map((a) => {
      const isDefault = a.id === defaultId;
      return `<li class="acct-block acct-address">
          <div class="acct-view">
            <div class="acct-address-head">
              <address class="ord-address">${addressLines(a)}</address>
              ${isDefault ? `<span class="pill mint">Default</span>` : ""}
            </div>
            <div class="btn-row acct-links">
              <button class="btn link" type="button" data-edit>Edit</button>
              <button class="btn link" type="button" data-intent="address-delete" data-id="${esc(a.id)}">Remove</button>
              ${isDefault ? "" : `<button class="btn link" type="button" data-intent="address-default" data-id="${esc(a.id)}">Make default</button>`}
            </div>
            <p class="notice warn acct-msg" hidden></p>
          </div>
          ${addressForm(a, "address-update")}
        </li>`;
    })
    .join("");

  const saved = `
    <div class="card">
      <div class="card-head">
        <div><h2 class="h2">Saved addresses</h2><p class="muted" style="margin:0">Shipping and billing addresses for future orders.</p></div>
      </div>
      ${list ? `<ul class="acct-list">${list}</ul>` : `<p class="muted">You don't have any saved addresses yet.</p>`}
      <div class="acct-block acct-new">
        <div class="acct-view"><button class="btn outline" type="button" data-edit>+ Add address</button></div>
        ${addressForm(null, "address-create")}
      </div>
    </div>`;

  const active = orders.find((o) => o.shippingAddress);
  const s = active?.shippingAddress;
  const activeBlock = s
    ? `<div class="card flat">
        <div class="label" style="margin-bottom:8px">Active order address · ${esc(active!.name)}</div>
        <address class="ord-address">${[
          s.name,
          s.address1,
          s.address2,
          [s.city, [s.provinceCode, s.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .map((l) => esc(l))
          .join("<br>")}</address>
        <div class="notice warn" style="margin:14px 0 0">Updating a saved address does not change an existing order. To change where this order is delivered, <a href="${ctx.url("/support")}" data-hub-chat>message us</a>.</div>
      </div>`
    : "";

  const body = `
    <div class="page-head">
      <h1 class="h1">Your account, all in one place.</h1>
      <p class="lede">Manage your contact details, saved addresses, and account settings.</p>
    </div>
    ${updated ? `<div class="notice">Your changes have been saved.</div>` : ""}
    <div class="acct" id="hub-account" data-config="${esc(JSON.stringify({ url: ctx.url("/account") }))}">
      <div class="with-aside">
        <div>${personal}${saved}</div>
        <aside>${activeBlock}</aside>
      </div>
    </div>
    <script src="${asset("hub-account.js")}" defer></script>`;

  return renderHub(ctx, "account", "Account & Addresses", body);
};

// ---------------------------------------------------------------- actions

const fail = (message: string, status = 400) => Response.json({ ok: false, message }, { status });

/** Shopify's userErrors as one readable sentence. */
const friendly = (errors: UserError[]) =>
  errors
    .map((e) => {
      const f = e.field?.[e.field.length - 1] ?? "";
      if (/phone/i.test(f) && /invalid/i.test(e.message)) return "Please enter a valid phone number, including the area code.";
      if (/phone/i.test(f) && /taken/i.test(e.message)) return "That phone number is already used by another account.";
      if (/zip/i.test(f)) return "Please check the ZIP code matches the state.";
      if (/province/i.test(f)) return "Please enter a valid state, e.g. NJ.";
      return e.message;
    })
    .filter((m, i, all) => all.indexOf(m) === i)
    .join(" ");

/** "(555) 555-0123" → "+15555550123"; Shopify wants customer phones in E.164. */
function e164(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  const { ctx } = await hubContext(request);
  if (!ctx) return fail("Please sign in again.", 401);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, max = 255) => (typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "");
  const intent = str("intent");

  const run = async (query: string, variables: Record<string, unknown>, key: string) => {
    const res = await ctx.admin.graphql(query, { variables });
    const json = (await res.json()) as { data?: Record<string, { userErrors: UserError[] } | null>; errors?: unknown };
    const payload = json.data?.[key];
    if (!payload) {
      console.error(`[proxy/account] ${key}`, JSON.stringify(json.errors ?? json));
      return fail("Something went wrong. Please try again.", 500);
    }
    if (payload.userErrors.length) return fail(friendly(payload.userErrors));
    return Response.json({ ok: true, message: "Saved." });
  };

  // The address has to be one of this customer's: never trust an id from the browser.
  const ownAddressId = async () => {
    const id = str("id", 200);
    const customer = await loadCustomer(ctx);
    return customer?.addressesV2.nodes.find((a) => a.id === id)?.id ?? null;
  };

  const addressInput = () => {
    const countryCode = str("countryCode", 2).toUpperCase() || "US";
    const address = {
      firstName: str("firstName", 100),
      lastName: str("lastName", 100),
      company: str("company", 100),
      address1: str("address1"),
      address2: str("address2"),
      city: str("city", 100),
      provinceCode: str("provinceCode", 3).toUpperCase(),
      zip: str("zip", 20),
      countryCode,
      phone: str("phone", 30),
    };
    const missing = (
      [
        ["firstName", "first name"],
        ["lastName", "last name"],
        ["address1", "address"],
        ["city", "city"],
        ["provinceCode", "state"],
        ["zip", "ZIP code"],
      ] as const
    )
      .filter(([k]) => !address[k])
      .map(([, label]) => label);
    if (missing.length) return { error: `Please add your ${missing.join(", ")}.` };
    if (!/^[A-Z]{2}$/.test(countryCode)) return { error: "Please choose a country." };
    if (countryCode === "US" && !/^\d{5}(-\d{4})?$/.test(address.zip)) return { error: "Please enter a 5-digit ZIP code." };
    return { address };
  };

  try {
    switch (intent) {
      case "profile": {
        const firstName = str("firstName", 100);
        const lastName = str("lastName", 100);
        if (!firstName && !lastName) return fail("Please add your name.");
        const phone = e164(str("phone", 30));
        if (phone === null) return fail("Please enter a valid phone number, including the area code.");
        return await run(
          CUSTOMER_UPDATE,
          { input: { id: ctx.customerId, firstName, lastName, phone: phone || null } },
          "customerUpdate",
        );
      }
      case "address-create": {
        const { address, error } = addressInput();
        if (!address) return fail(error);
        return await run(
          ADDRESS_CREATE,
          { customerId: ctx.customerId, address, setAsDefault: body.setAsDefault === true },
          "customerAddressCreate",
        );
      }
      case "address-update": {
        const { address, error } = addressInput();
        if (!address) return fail(error);
        const addressId = await ownAddressId();
        if (!addressId) return fail("We couldn't find that address. Please refresh the page.", 404);
        return await run(ADDRESS_UPDATE, { customerId: ctx.customerId, addressId, address }, "customerAddressUpdate");
      }
      case "address-delete": {
        const addressId = await ownAddressId();
        if (!addressId) return fail("We couldn't find that address. Please refresh the page.", 404);
        return await run(ADDRESS_DELETE, { customerId: ctx.customerId, addressId }, "customerAddressDelete");
      }
      case "address-default": {
        const addressId = await ownAddressId();
        if (!addressId) return fail("We couldn't find that address. Please refresh the page.", 404);
        return await run(ADDRESS_DEFAULT, { customerId: ctx.customerId, addressId }, "customerUpdateDefaultAddress");
      }
      default:
        return fail("Unknown request.");
    }
  } catch (e) {
    console.error("[proxy/account]", intent, e);
    return fail("Something went wrong. Please try again.", 500);
  }
};
