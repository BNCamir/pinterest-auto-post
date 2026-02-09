/**
 * List Canva Brand Templates so you can get the correct CANVA_TEMPLATE_ID.
 *
 * The ID in a design URL (e.g. .../design/DAHAfCDkhAc/...) is a design ID.
 * The Autofill API uses Brand Template IDs. You must publish your design as a
 * Brand Template in Canva first: open the design → Share → Publish as Brand Template.
 * Then run this script to see your templates and their IDs.
 *
 * Requires: CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, CANVA_REFRESH_TOKEN in .env
 * Run: npm run canva-list-templates
 */

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const BASE = "https://api.canva.com/rest/v1";

async function getAccessToken(): Promise<string> {
  const clientId = process.env.CANVA_CLIENT_ID?.trim();
  const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in .env");
  }
  const tokenPath = join(process.cwd(), ".canva-refresh-token");
  let refreshToken = process.env.CANVA_REFRESH_TOKEN?.trim();
  if (existsSync(tokenPath) && !refreshToken) {
    try {
      refreshToken = readFileSync(tokenPath, "utf8").trim();
    } catch {
      // ignore
    }
  }
  if (!refreshToken) {
    throw new Error("Set CANVA_REFRESH_TOKEN in .env or run npm run canva-oauth first");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("No access_token in response");
  return data.access_token;
}

type BrandTemplate = {
  id?: string;
  name?: string;
  title?: string;
  thumbnail?: { url?: string };
};

type ListResponse = {
  brand_templates?: BrandTemplate[];
  continuation?: string;
};

async function main() {
  console.log("Fetching Canva Brand Templates...\n");
  const token = await getAccessToken();
  const templates: BrandTemplate[] = [];
  let continuation: string | undefined;
  do {
    const url = new URL(`${BASE}/brand-templates`);
    url.searchParams.set("limit", "50");
    url.searchParams.set("dataset", "with_dataset"); // only templates with autofill fields
    if (continuation) url.searchParams.set("continuation", continuation);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(`API error: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const data = (await res.json()) as ListResponse;
    const list = data.brand_templates ?? [];
    templates.push(...list);
    continuation = data.continuation;
  } while (continuation);

  if (templates.length === 0) {
    console.log("No brand templates found.");
    console.log("\nTo use a design as a template:");
    console.log("1. Open your design in Canva");
    console.log("2. Share → Publish as Brand Template (requires Canva Teams/Enterprise)");
    console.log("3. Run this script again to see the template ID.");
    return;
  }

  console.log(`Found ${templates.length} brand template(s):\n`);
  for (const t of templates) {
    const id = t.id ?? "(no id)";
    const name = t.name ?? t.title ?? "(no name)";
    console.log(`  ID:   ${id}`);
    console.log(`  Name: ${name}`);
    console.log("");
  }
  console.log("Set CANVA_TEMPLATE_ID in .env to one of the IDs above.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
