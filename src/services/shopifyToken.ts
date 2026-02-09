/**
 * Resolves Shopify Admin API access token: uses static token from config,
 * or fetches via Client Credentials Grant (client_id + client_secret + store).
 * Caches the token in memory and refreshes when expired (for headless/deployed engines).
 */

import type { AppConfig } from "../config.js";

const SHOP_NOT_PERMITTED_MSG =
  "Shopify returned 'shop_not_permitted': Client Credentials Grant is only allowed for apps and stores owned by the same organization. " +
  "Get a token via OAuth: run 'npm run shopify-auth', complete the browser flow, then add the token to .env as SHOPIFY_ACCESS_TOKEN.";

let cached: { token: string; expiresAt: number } | null = null;

function getStoreFromConfig(config: AppConfig): string {
  const store = config.SHOPIFY_STORE?.trim();
  if (store) return store;
  const base = config.SHOPIFY_ADMIN_API_BASE_URL?.trim() ?? "";
  const m = base.match(/https:\/\/([^.]+)\.myshopify\.com/);
  return m ? m[1] : "couture-candies";
}

/**
 * Fetches an access token via Client Credentials Grant.
 * Throws with a clear message if Shopify returns shop_not_permitted.
 */
async function fetchTokenWithClientCredentials(config: AppConfig): Promise<{
  access_token: string;
  expires_in?: number;
}> {
  const clientId = config.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = config.SHOPIFY_CLIENT_SECRET?.trim();
  const store = getStoreFromConfig(config);

  if (!clientId || !clientSecret) {
    throw new Error("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required when SHOPIFY_ACCESS_TOKEN is not set");
  }

  const url = `https://${store}.myshopify.com/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await response.text();
  if (text.includes("shop_not_permitted") || text.includes("Client credentials cannot be performed")) {
    throw new Error(SHOP_NOT_PERMITTED_MSG);
  }

  if (!response.ok) {
    throw new Error(`Shopify token request failed: ${response.status} ${text.slice(0, 200)}`);
  }

  let data: { access_token?: string; expires_in?: number };
  try {
    data = JSON.parse(text) as { access_token?: string; expires_in?: number };
  } catch {
    throw new Error(`Shopify token response was not JSON: ${text.slice(0, 200)}`);
  }

  if (!data.access_token) {
    throw new Error(`Shopify token response missing access_token: ${text.slice(0, 200)}`);
  }

  return { access_token: data.access_token, expires_in: data.expires_in };
}

/**
 * Returns a valid Shopify Admin API access token.
 * Uses SHOPIFY_ACCESS_TOKEN if set; otherwise fetches via Client Credentials and caches.
 */
export async function getShopifyAccessToken(config: AppConfig): Promise<string> {
  const staticToken = config.SHOPIFY_ACCESS_TOKEN?.trim();
  if (staticToken) return staticToken;

  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  const result = await fetchTokenWithClientCredentials(config);
  const expiresIn = result.expires_in ?? 86400;
  cached = {
    token: result.access_token,
    expiresAt: now + (expiresIn * 1000)
  };
  return result.access_token;
}
