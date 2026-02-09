/**
 * Get a Shopify Admin API access token via Client Credentials Grant (Jan 2026+).
 * No browser or redirect needed. Run: npm run shopify-token
 * Set in .env: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE
 */

import "dotenv/config";

async function main(): Promise<void> {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const store = process.env.SHOPIFY_STORE?.trim() || "couture-candies";

  if (!clientId || !clientSecret) {
    console.error("Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env");
    process.exit(1);
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
    console.error("Token request failed:", response.status, text);
    process.exit(1);
  }

  const data = (await response.json()) as { access_token?: string };
  const token = data.access_token;

  if (!token) {
    console.error("Response missing access_token:", data);
    process.exit(1);
  }

  console.log("Add this to your .env:\n");
  console.log(`SHOPIFY_ACCESS_TOKEN=${token}`);
  console.log(`\nBase URL: https://${store}.myshopify.com/admin/api/2024-01`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
