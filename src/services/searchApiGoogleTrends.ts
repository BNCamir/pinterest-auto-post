/**
 * Fetches Food & Drink trending keywords from Google Trends via SearchApi.
 * Uses the category "Food & Drink" (cat=71) with RELATED_QUERIES to get
 * top and rising search terms for that category (same as the Food & Drink
 * section on trends.google.com).
 * @see https://www.searchapi.io/docs/google-trends
 * @see https://www.searchapi.io/docs/parameters/google-trends/categories (71 = Food & Drink)
 */

import { requestJson } from "../http.js";

/** Google Trends category ID: Food & Drink */
const FOOD_DRINK_CATEGORY_ID = "71";

export type TrendItem = {
  keyword: string;
  score?: number;
  rising?: boolean;
};

type SearchApiRelatedQueriesResponse = {
  related_queries?: {
    top?: Array<{ query?: string; extracted_value?: number; value?: string }>;
    rising?: Array<{ query?: string; extracted_value?: number; value?: string }>;
  };
  error?: string;
};

export type FetchFoodDrinkTrendsInput = {
  apiKey: string;
  /** Geo for trends (default US). */
  geo?: string;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
};

const SEARCHAPI_BASE = "https://www.searchapi.io/api/v1/search";

/**
 * Returns trending keywords for the Food & Drink category from Google Trends
 * via SearchApi (RELATED_QUERIES with cat=71, no query = overall category trends).
 */
export async function fetchFoodDrinkTrendsFromSearchApi(
  input: FetchFoodDrinkTrendsInput
): Promise<TrendItem[]> {
  const params = new URLSearchParams({
    engine: "google_trends",
    api_key: input.apiKey,
    data_type: "RELATED_QUERIES",
    cat: FOOD_DRINK_CATEGORY_ID,
    geo: input.geo ?? "US"
  });

  const url = `${SEARCHAPI_BASE}?${params.toString()}`;
  const data = await requestJson<SearchApiRelatedQueriesResponse>(url, {
    method: "GET",
    timeoutMs: input.timeoutMs ?? 15000
  });

  if (data.error) {
    throw new Error(`SearchApi Google Trends error: ${data.error}`);
  }

  const items: TrendItem[] = [];
  const seen = new Set<string>();

  const push = (query: string, score: number, rising: boolean) => {
    const k = query.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    items.push({ keyword: query.trim(), score, rising });
  };

  for (const row of data.related_queries?.top ?? []) {
    const q = row.query?.trim();
    if (q) push(q, row.extracted_value ?? 0, false);
  }
  for (const row of data.related_queries?.rising ?? []) {
    const q = row.query?.trim();
    if (q) push(q, row.extracted_value ?? 0, true);
  }

  return items;
}
