/**
 * Fetches a fresh Shopify token, then runs the pipeline with it.
 * Use for daily runs so each run gets a new token. Run: npm run daily
 * Requires in .env: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE
 */

import "dotenv/config";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function fetchShopifyToken(): Promise<string> {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const store = process.env.SHOPIFY_STORE?.trim() || "couture-candies";

  if (!clientId || !clientSecret) {
    throw new Error("Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env");
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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify token failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Shopify response missing access_token");
  return data.access_token;
}

async function main(): Promise<void> {
  console.log("Fetching fresh Shopify token...");
  const token = await fetchShopifyToken();
  console.log("Token received. Starting pipeline...\n");

  const env = { ...process.env, SHOPIFY_ACCESS_TOKEN: token };
  const isDev = process.argv.includes("--dev");
  const cmd = isDev ? "tsx" : "node";
  const script = isDev
    ? join(__dirname, "..", "index.ts")
    : join(__dirname, "..", "index.js");

  const child = spawn(cmd, [script], {
    env,
    stdio: "inherit",
    shell: true
  });

  child.on("close", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
