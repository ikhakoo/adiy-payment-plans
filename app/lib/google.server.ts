// Google Drive via OAuth (org policy blocks service-account keys). Tokens belong to whoever
// clicked "Connect Google Drive"; everything is written into one Shared Drive.
import db from "../db.server";
import { decrypt, encrypt } from "./crypto.server";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive"];

export const redirectUri = () => `${process.env.SHOPIFY_APP_URL}/google/callback`;

function clientCreds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  return { id, secret };
}

export function authorizationUrl(state: string) {
  const params = new URLSearchParams({
    client_id: clientCreds().id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token, even on reconnect
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/** Exchanges the OAuth code and stores the (encrypted) refresh token for the shop. */
export async function completeAuthorization(shop: string, code: string) {
  const { id, secret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as { refresh_token?: string; id_token?: string; error?: string };
  if (!res.ok || !json.refresh_token) throw new Error(`Google token exchange failed: ${json.error ?? res.status}`);
  const email = json.id_token
    ? (JSON.parse(Buffer.from(json.id_token.split(".")[1], "base64url").toString()).email as string)
    : "unknown";
  await db.googleConnection.upsert({
    where: { shop },
    create: { shop, email, refreshToken: encrypt(json.refresh_token) },
    update: { email, refreshToken: encrypt(json.refresh_token), connectedAt: new Date() },
  });
  tokenCache.delete(shop);
  return email;
}

// ---------------------------------------------------------------- access tokens

const tokenCache = new Map<string, { token: string; expires: number }>();

export class GoogleNotConnected extends Error {
  constructor() {
    super("Google Drive isn't connected");
  }
}

async function accessToken(shop: string) {
  const cached = tokenCache.get(shop);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const conn = await db.googleConnection.findUnique({ where: { shop } });
  if (!conn) throw new GoogleNotConnected();
  const { id, secret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: decrypt(conn.refreshToken),
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    // invalid_grant = revoked, password reset, or the account was removed: reconnect needed.
    if (json.error === "invalid_grant") throw new GoogleNotConnected();
    throw new Error(`Google token refresh failed: ${json.error ?? res.status}`);
  }
  tokenCache.set(shop, { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

async function drive<T>(shop: string, path: string, init: RequestInit & { query?: Record<string, string> } = {}) {
  const url = new URL(`${DRIVE}${path}`);
  url.searchParams.set("supportsAllDrives", "true");
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${await accessToken(shop)}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`Drive ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// ---------------------------------------------------------------- drives and folders

export async function listSharedDrives(shop: string) {
  const data = await drive<{ drives: { id: string; name: string }[] }>(shop, "/drives", {
    query: { pageSize: "100" },
  });
  return data.drives;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** The folder called `name` inside `parentId`, created if it doesn't exist. */
export async function ensureFolder(shop: string, driveId: string, parentId: string, name: string) {
  const found = await drive<{ files: { id: string }[] }>(shop, "/files", {
    query: {
      corpora: "drive",
      driveId,
      includeItemsFromAllDrives: "true",
      q: `name = '${q(name)}' and '${parentId}' in parents and mimeType = '${FOLDER}' and trashed = false`,
      fields: "files(id)",
    },
  });
  if (found.files[0]) return found.files[0].id;
  const created = await drive<{ id: string }>(shop, "/files", {
    method: "POST",
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    query: { fields: "id" },
  });
  return created.id;
}

export async function moveItem(shop: string, id: string, toParentId: string) {
  const current = await drive<{ parents?: string[] }>(shop, `/files/${id}`, { query: { fields: "parents" } });
  await drive(shop, `/files/${id}`, {
    method: "PATCH",
    body: "{}",
    query: { addParents: toParentId, removeParents: (current.parents ?? []).join(","), fields: "id" },
  });
}

export async function getFile(shop: string, id: string) {
  return drive<{ id: string; name: string; mimeType: string; size?: string; parents?: string[]; trashed?: boolean }>(
    shop,
    `/files/${id}`,
    { query: { fields: "id,name,mimeType,size,parents,trashed" } },
  );
}

/**
 * Starts a resumable upload into `parentId` and returns the session URL. The customer's browser
 * PUTs the bytes straight to it; passing the page's Origin here is what lets that cross-origin
 * upload through CORS.
 */
export async function startResumableUpload(
  shop: string,
  args: { name: string; mimeType: string; size: number; parentId: string; origin: string },
) {
  const url = new URL(`${UPLOAD}/files`);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,size,mimeType,parents");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await accessToken(shop)}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": args.mimeType,
      "x-upload-content-length": String(args.size),
      origin: args.origin,
    },
    body: JSON.stringify({ name: args.name, parents: [args.parentId] }),
  });
  const location = res.headers.get("location");
  if (!res.ok || !location) throw new Error(`Drive upload session failed: ${res.status} ${await res.text()}`);
  return location;
}
