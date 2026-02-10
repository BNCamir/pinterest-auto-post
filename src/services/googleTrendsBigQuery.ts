/**
 * Fetches trending keywords from the Google Trends BigQuery public dataset.
 * Uses Top 25 and Top 25 Rising tables per:
 * https://support.google.com/trends/answer/12764470
 * https://cloud.google.com/blog/products/data-analytics/top-25-google-search-terms-now-in-bigquery
 */

import { BigQuery, type BigQueryOptions } from "@google-cloud/bigquery";

export type TrendItem = {
  keyword: string;
  score?: number;
  rising?: boolean;
};

const US_TOP_TERMS =
  "`bigquery-public-data.google_trends.top_terms`";
const US_TOP_RISING =
  "`bigquery-public-data.google_trends.top_rising_terms`";

/** Use the most recent partition (data refreshed daily ~12AM EST; timezone-safe). */
const LATEST_REFRESH = `(SELECT MAX(refresh_date) FROM ${US_TOP_TERMS})`;

export type FetchTrendsFromBigQueryInput = {
  projectId: string;
  /** Path to service account JSON file (optional if credentials provided). */
  keyFilename?: string;
  /** Inline service account JSON (e.g. for Railway). Overrides keyFilename. */
  credentialsJson?: string;
  /** Max terms to return from top_terms (default 25). */
  topLimit?: number;
  /** Include top_rising_terms and mark those as rising (default true). */
  includeRising?: boolean;
};

/**
 * Returns trending keywords from BigQuery Google Trends (US dataset).
 * Merges top_terms (score, rank) with top_rising_terms (rising=true).
 */
export async function fetchTrendsFromBigQuery(
  input: FetchTrendsFromBigQueryInput
): Promise<TrendItem[]> {
  const options: BigQueryOptions = {
    projectId: input.projectId,
    location: "US"
  };
  if (input.credentialsJson) {
    try {
      options.credentials = JSON.parse(input.credentialsJson) as object;
    } catch {
      throw new Error("GCP_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  } else if (input.keyFilename) {
    options.keyFilename = input.keyFilename;
  }

  const bigquery = new BigQuery(options);

  const topQuery = `
    SELECT term, score, \`rank\`
    FROM ${US_TOP_TERMS}
    WHERE refresh_date = ${LATEST_REFRESH}
    ORDER BY \`rank\` ASC
    LIMIT ${Math.min(Number(input.topLimit) || 25, 100)}
  `;

  const queryOptions = { query: topQuery, location: "US" as const };
  const [topRows] = await bigquery.query(queryOptions);
  const topByTerm = new Map<string, { score: number; rank: number }>();
  for (const row of topRows as { term: string; score: number; rank: number }[]) {
    if (row.term) topByTerm.set(row.term, { score: row.score ?? 0, rank: row.rank ?? 0 });
  }

  const risingTerms = new Set<string>();
  if (input.includeRising !== false) {
    const risingQuery = `
      SELECT DISTINCT term
      FROM ${US_TOP_RISING}
      WHERE refresh_date = (SELECT MAX(refresh_date) FROM ${US_TOP_RISING})
      LIMIT 25
    `;
    const [risingRows] = await bigquery.query({ query: risingQuery, location: "US" });
    for (const row of risingRows as { term: string }[]) {
      if (row.term) risingTerms.add(row.term);
    }
  }

  const items: TrendItem[] = [];
  for (const [term, { score }] of topByTerm) {
    items.push({
      keyword: term,
      score,
      rising: risingTerms.has(term)
    });
  }
  for (const term of risingTerms) {
    if (!topByTerm.has(term)) {
      items.push({ keyword: term, score: 0, rising: true });
    }
  }

  return items;
}
