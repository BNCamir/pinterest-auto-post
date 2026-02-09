import "dotenv/config";
import { withClient } from "../db/index.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const limit = parseInt(process.argv[2] ?? "10", 10) || 10;

  const rows = await withClient(url, async (client) => {
    const r = await client.query(
      `SELECT id, title, destination_url, platform_url, created_at
       FROM pins
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return r.rows as { id: number; title: string; destination_url: string; platform_url: string | null; created_at: Date }[];
  });

  if (rows.length === 0) {
    console.log("No pins found.");
    return;
  }
  console.log(`Recent pins (${rows.length}):\n`);
  for (const row of rows) {
    console.log(`  ID: ${row.id}`);
    console.log(`  Title: ${row.title}`);
    console.log(`  Blog URL: ${row.destination_url}`);
    console.log(`  Pin URL:  ${row.platform_url ?? "(none)"}`);
    console.log(`  Created:  ${row.created_at}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
