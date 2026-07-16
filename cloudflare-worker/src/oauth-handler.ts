import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { DEFAULT_BASE_URL } from "./southpay";

// Browser login flow: /authorize sends the user to the Southpay dashboard's
// consent page (the worker is the first-party public client spo_app_mcp),
// and /callback exchanges the resulting code for an OAuth access token, then
// mints a scoped spa_ agent credential which becomes the session's props.
// The MCP client only ever sees tokens issued by this worker's own
// OAuthProvider; Southpay keys never leave the server side.

export type OAuthEnv = {
  OAUTH_PROVIDER: OAuthHelpers;
  OAUTH_KV: KVNamespace;
  SOUTHPAY_BASE_URL?: string;
  SOUTHPAY_DASHBOARD_URL?: string;
};

const DEFAULT_DASHBOARD_URL = "https://app.southpay.io";
const UPSTREAM_CLIENT_ID = "spo_app_mcp";
const UPSTREAM_SCOPE = "profile stores:read agents:write";
const LOGIN_STATE_TTL_SECONDS = 600;

type Json = Record<string, unknown>;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function apiBase(env: OAuthEnv): string {
  return (env.SOUTHPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function dashboardBase(env: OAuthEnv): string {
  return (env.SOUTHPAY_DASHBOARD_URL || DEFAULT_DASHBOARD_URL).replace(/\/+$/, "");
}

function callbackUrl(request: Request): string {
  return new URL("/callback", request.url).toString();
}

function errorPage(title: string, detail: string, status = 400): Response {
  const body = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; line-height: 1.5">
<h1 style="font-size: 1.25rem">${title}</h1><p>${detail}</p>
<p>Close this window and try connecting again.</p></body>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handleAuthorize(request: Request, env: OAuthEnv): Promise<Response> {
  let oauthReqInfo;
  try {
    oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (err) {
    return errorPage(
      "Invalid authorization request",
      err instanceof Error ? err.message : String(err),
    );
  }

  const nonce = crypto.randomUUID();
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64url(verifierBytes);

  await env.OAUTH_KV.put(`login:${nonce}`, JSON.stringify({ oauthReqInfo, verifier }), {
    expirationTtl: LOGIN_STATE_TTL_SECONDS,
  });

  const authorizeUrl = new URL("/oauth/authorize", dashboardBase(env));
  authorizeUrl.searchParams.set("client_id", UPSTREAM_CLIENT_ID);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl(request));
  authorizeUrl.searchParams.set("scope", UPSTREAM_SCOPE);
  authorizeUrl.searchParams.set("code_challenge", await pkceChallenge(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", nonce);
  // Skip first-party auto-approve: the consent screen is where the user picks
  // the store and live/test mode for the session.
  authorizeUrl.searchParams.set("prompt", "consent");

  return Response.redirect(authorizeUrl.toString(), 302);
}

async function handleCallback(request: Request, env: OAuthEnv): Promise<Response> {
  const url = new URL(request.url);

  const upstreamError = url.searchParams.get("error");
  if (upstreamError) {
    return errorPage(
      "Login was not completed",
      upstreamError === "access_denied"
        ? "You declined the connection request."
        : `Southpay returned: ${upstreamError}`,
    );
  }

  const code = url.searchParams.get("code");
  const nonce = url.searchParams.get("state");
  if (!code || !nonce) {
    return errorPage("Invalid callback", "Missing code or state parameter.");
  }

  const stored = await env.OAUTH_KV.get(`login:${nonce}`);
  if (!stored) {
    return errorPage("Login expired", "The login attempt expired or was already used.");
  }
  await env.OAUTH_KV.delete(`login:${nonce}`);

  const { oauthReqInfo, verifier } = JSON.parse(stored);

  const tokenResp = await fetch(`${apiBase(env)}/api/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: callbackUrl(request),
      client_id: UPSTREAM_CLIENT_ID,
    }),
  });
  const tokenBody = (await tokenResp.json().catch(() => ({}))) as Json;
  if (tokenResp.status !== 200 || typeof tokenBody.access_token !== "string") {
    return errorPage(
      "Login failed",
      `Could not exchange the authorization code (${tokenBody.error ?? tokenResp.status}).`,
      502,
    );
  }

  const mintResp = await fetch(`${apiBase(env)}/api/v2/oauth/agent_credentials`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: "{}",
  });
  const mintBody = (await mintResp.json().catch(() => ({}))) as Json;
  if (mintResp.status !== 201 || typeof mintBody.secret !== "string") {
    return errorPage(
      "Login failed",
      `Could not create an agent credential (${JSON.stringify(mintBody.error ?? mintResp.status)}).`,
      502,
    );
  }

  // The provider encodes userId into colon-delimited codes and KV keys, so it
  // must not contain ":". The credential UUID is colon-free and stable across
  // re-logins (rotation reuses the row), unlike agent_principal.
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: String(mintBody.id),
    metadata: {
      store_id: tokenBody.store_id,
      mode: mintBody.mode,
      agent_principal: mintBody.agent_principal,
    },
    scope: oauthReqInfo.scope,
    props: { agentKey: mintBody.secret },
  });

  return Response.redirect(redirectTo, 302);
}

export async function oauthDefaultHandler(request: Request, env: OAuthEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response("southpay-mcp", { status: 200 });
  }
  if (url.pathname === "/authorize") {
    return handleAuthorize(request, env);
  }
  if (url.pathname === "/callback") {
    return handleCallback(request, env);
  }

  return new Response("Not found", { status: 404 });
}
