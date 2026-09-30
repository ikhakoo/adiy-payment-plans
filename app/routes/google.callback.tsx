import type { LoaderFunctionArgs } from "react-router";
import { completeAuthorization } from "../lib/google.server";
import { verifyState } from "../lib/crypto.server";

// Google redirects here (top-level, outside the admin iframe) after "Connect Google Drive".
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const state = verifyState(url.searchParams.get("state") ?? "");
  if (!state?.shop) return new Response("This link has expired. Start again from the app.", { status: 400 });

  const back = `https://${state.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/rewards-settings`;
  const error = url.searchParams.get("error");
  if (error) return Response.redirect(`${back}?google=${encodeURIComponent(error)}`, 302);

  try {
    await completeAuthorization(state.shop, url.searchParams.get("code") ?? "");
  } catch (e) {
    console.error("[google/callback]", e);
    return Response.redirect(`${back}?google=failed`, 302);
  }
  return Response.redirect(`${back}?google=connected`, 302);
};
