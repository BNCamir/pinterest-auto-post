/**
 * List blogs on your Shopify store so you can set the correct SHOPIFY_BLOG_ID.
 * Run: npx tsx src/scripts/shopify-list-blogs.ts
 * Requires: SHOPIFY_ADMIN_API_BASE_URL and SHOPIFY_ACCESS_TOKEN (or SHOPIFY_CLIENT_ID + SECRET + STORE for token)
 */

import "dotenv/config";
import { getShopifyAccessToken } from "../services/shopifyToken.js";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const baseUrl = config.SHOPIFY_ADMIN_API_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("Set SHOPIFY_ADMIN_API_BASE_URL in .env");
    process.exit(1);
  }

  const token = await getShopifyAccessToken(config);
  if (!token) {
    console.error("Could not get Shopify access token. Set SHOPIFY_ACCESS_TOKEN or client credentials.");
    process.exit(1);
  }

  const url = `${baseUrl}/blogs.json?limit=50`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": token }
  });

  if (!res.ok) {
    console.error("Shopify API error:", res.status, await res.text());
    process.exit(1);
  }

  const data = (await res.json()) as { blogs?: { id: number; handle: string; title: string }[] };
  const blogs = data.blogs ?? [];
  if (blogs.length === 0) {
    console.log("No blogs found on this store. Create a blog in Shopify Admin first (Online Store > Blog).");
    process.exit(0);
  }

  console.log("\nBlogs on your store – use the ID below as SHOPIFY_BLOG_ID and handle as SHOPIFY_BLOG_HANDLE:\n");
  for (const b of blogs) {
    console.log(`  ID: ${b.id}  |  handle: ${b.handle}  |  title: ${b.title}`);
  }
  console.log("\nExample .env:");
  const first = blogs[0];
  console.log(`  SHOPIFY_BLOG_ID=${first.id}`);
  console.log(`  SHOPIFY_BLOG_HANDLE=${first.handle}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
