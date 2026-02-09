/**
 * One-time script to get a Shopify Admin API access token via OAuth (Partners app).
 * Run: npm run shopify-auth
 * Set in .env: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE (e.g. couture-candies)
 * Add redirect URL in Partners: http://localhost:3456/callback
 */

import "dotenv/config";
import { createServer } from "http";

const PORT = 3456;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

async function main(): Promise<void> {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const store = process.env.SHOPIFY_STORE?.trim() || "couture-candies";

  if (!clientId || !clientSecret) {
    console.error("Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env");
    process.exit(1);
  }

  const installUrl =
    `https://${store}.myshopify.com/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent("write_content,read_content")}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname !== "/callback") {
      res.writeHead(302, { Location: installUrl });
      res.end();
      return;
    }

    const code = url.searchParams.get("code");
    const shop = url.searchParams.get("shop");

    if (!code || !shop) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<p>Missing code or shop. Try again and approve the app.</p><p>Close this tab.</p>"
      );
      server.close();
      return;
    }

    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    const body = JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code
    });

    let token: string;
    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      const data = (await response.json()) as { access_token: string };
      token = data.access_token;
    } catch (err) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<p>Token exchange failed: ${(err as Error).message}</p><p>Close this tab.</p>`);
      server.close();
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<p><strong>Success.</strong> Add this to your .env:</p>` +
        `<pre>SHOPIFY_ACCESS_TOKEN=${token}</pre>` +
        `<p>Store host for base URL: <code>https://${shop}/admin/api/2024-01</code></p>` +
        `<p>Close this tab and stop the script (Ctrl+C).</p>`
    );
    server.close();
  });

  server.listen(PORT, () => {
    console.log(`Open this URL in your browser to install the app:\n  ${installUrl}\n`);
    console.log(`Or run: start ${installUrl}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
