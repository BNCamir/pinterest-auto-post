/**
 * Test SearchApi Food & Drink trends (validates SEARCHAPI_API_KEY).
 * Run: npx tsx src/scripts/test-searchapi-trends.ts
 * Requires: SEARCHAPI_API_KEY in .env
 */

import "dotenv/config";
import { fetchFoodDrinkTrendsFromSearchApi } from "../services/searchApiGoogleTrends.js";

async function main(): Promise<void> {
  const apiKey = process.env.SEARCHAPI_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set SEARCHAPI_API_KEY in .env");
    process.exit(1);
  }

  console.log("Fetching Food & Drink trends from SearchApi...");
  try {
    const trends = await fetchFoodDrinkTrendsFromSearchApi({
      apiKey,
      geo: "US",
      timeoutMs: 15000
    });
    console.log(`\nSearchApi OK. Fetched ${trends.length} Food & Drink trend items:\n`);
    trends.slice(0, 15).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.keyword}${t.rising ? " (rising)" : ""}`);
    });
    if (trends.length > 15) {
      console.log(`  ... and ${trends.length - 15} more`);
    }
    console.log("\nAPI key is working. Use GOOGLE_TRENDS_SOURCE=searchapi_food to use these in the pipeline.");
  } catch (err) {
    console.error("SearchApi test failed:", (err as Error).message);
    process.exit(1);
  }
}

main();
