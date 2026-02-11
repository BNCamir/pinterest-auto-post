/**
 * List Pinterest boards for your Getlate account.
 * Use the board "id" (long numeric) as PINTEREST_BOARD_ID in .env – NOT the Getlate account ID.
 *
 * Requires in .env: GETLATE_API_KEY, GETLATE_PINTEREST_ACCOUNT_ID
 * Run: npm run getlate-list-boards
 */

import "dotenv/config";
import { listPinterestBoards } from "../services/getlatePin.js";

async function main(): Promise<void> {
  const apiKey = process.env.GETLATE_API_KEY?.trim();
  const accountId = process.env.GETLATE_PINTEREST_ACCOUNT_ID?.trim();

  if (!apiKey || !accountId) {
    console.error("Set GETLATE_API_KEY and GETLATE_PINTEREST_ACCOUNT_ID in .env");
    process.exit(1);
  }

  console.log("Fetching Pinterest boards from Getlate...\n");
  const boards = await listPinterestBoards(apiKey, accountId);

  if (boards.length === 0) {
    console.log("No boards found.");
    return;
  }

  console.log("Use the 'id' below as PINTEREST_BOARD_ID in .env (not the Getlate account ID):\n");
  for (const b of boards) {
    console.log(`  id: ${b.id}  ${b.name ? `  name: ${b.name}` : ""}`);
  }
  console.log("\nExample: PINTEREST_BOARD_ID=" + (boards[0]?.id ?? ""));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
