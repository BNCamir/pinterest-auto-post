import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { withClient } from "../db/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sqlPath = join(__dirname, "../../sql/migrations/001_add_pins_platform_url.sql");
  const sql = readFileSync(sqlPath, "utf-8");
  await withClient(url, async (client) => {
    await client.query(sql);
  });
  console.log("Migration 001_add_pins_platform_url applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
