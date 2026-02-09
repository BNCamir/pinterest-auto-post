/**
 * Helper script to get a Canva refresh token via OAuth Authorization Code flow.
 * Run this once to get a refresh token, then add it to .env as CANVA_REFRESH_TOKEN.
 *
 * Usage:
 * 1. Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in .env
 * 2. Run: npm run canva-oauth
 * 3. Follow the browser flow to authorize
 * 4. Copy the refresh token to .env
 */

import "dotenv/config";
import { createServer } from "http";
import { URL } from "url";

const PORT = 3001;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

async function main() {
  const clientId = process.env.CANVA_CLIENT_ID?.trim();
  const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    console.error("Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in .env");
    process.exit(1);
  }

  // Step 1: Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Step 2: Build authorization URL
  const authUrl = new URL("https://www.canva.com/api/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  // Scopes must be enabled for your app in Developer Portal → Integration → Scopes
  // Minimal for creating designs + exporting: design:content:write, design:meta:read, asset:read, asset:write
  authUrl.searchParams.set("scope", "design:content:write design:meta:read asset:read asset:write brandtemplate:content:read brandtemplate:meta:read");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log("\n=== Canva OAuth Flow ===\n");
  console.log("1. Opening browser for authorization...");
  console.log(`2. Authorization URL: ${authUrl.toString()}\n`);

  // Start server to receive callback
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Error</h1><p>${error}</p>`);
        console.error(`\nOAuth error: ${error}`);
        server.close();
        process.exit(1);
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Error</h1><p>No authorization code received</p>");
        server.close();
        process.exit(1);
      }

      // Exchange code for tokens
      try {
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const tokenResponse = await fetch("https://api.canva.com/rest/v1/oauth/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier
          })
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <h1>Success!</h1>
          <p>Refresh token obtained. Add this to your .env:</p>
          <pre>CANVA_REFRESH_TOKEN=${tokenData.refresh_token}</pre>
          <p>Access token expires in ${tokenData.expires_in} seconds.</p>
        `);

        console.log("\n=== Success! ===\n");
        console.log("Add this to your .env file:");
        console.log(`CANVA_REFRESH_TOKEN=${tokenData.refresh_token}\n`);
        console.log("Access token expires in", tokenData.expires_in, "seconds");
        console.log("Refresh token can be used indefinitely (until revoked)\n");

        server.close();
        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<h1>Error</h1><p>${message}</p>`);
        console.error(`\nError: ${message}`);
        server.close();
        process.exit(1);
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  server.listen(PORT, () => {
    console.log(`3. Server listening on http://127.0.0.1:${PORT}`);
    console.log("4. Waiting for authorization...\n");
    
    // Open browser
    import("open").then(({ default: open }) => {
      open(authUrl.toString()).catch(() => {
        console.log("Could not open browser automatically. Please visit the URL above.");
      });
    }).catch(() => {
      console.log("Could not open browser automatically. Please visit the URL above.");
    });
  });
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString("base64url");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("base64url");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
