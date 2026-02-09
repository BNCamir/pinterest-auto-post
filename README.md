# BoxNCase Content Automation

Automated pipeline: **topic discovery** (Google Trends via BigQuery), BoxNCase context, SEO blog + Pinterest copy (OpenAI), blog publishing (Shopify), pin image (Gemini), pin creative (Templated.io), and Pinterest posting (direct API or via Getlate). Designed to run on Railway.

**Flow:** Google Trends (BigQuery) → best topics → BoxNCase context → topic selection → OpenAI content → Shopify blog → Gemini image → Templated.io pin (optional) → Pinterest (direct or Getlate).

## When you need API keys

| Step | Service | What you need |
|------|---------|----------------|
| 1. Topic discovery | **Google Trends (BigQuery)** | GCP project + service account (JSON key). [Get started](https://support.google.com/trends/answer/12764470). BigQuery free tier: 1 TB/month queries. |
| 1. Context | BoxNCase MCP | `BOXNCASE_MCP_URL` (+ optional token) if you use it. |
| 2. Content | OpenAI | `OPENAI_API_KEY`. |
| 3. Blog | Shopify | `SHOPIFY_ACCESS_TOKEN`, store URL, blog ID. |
| 4. Pin image | Gemini | `GEMINI_API_KEY`. |
| 5. Pin creative | **Templated.io** | `TEMPLATED_API_KEY`, `TEMPLATED_TEMPLATE_ID` (template from [templated.io](https://templated.io)). |
| 6. Publish pin | Pinterest (direct) | `PINTEREST_ACCESS_TOKEN`, board ID. Or **Getlate**: `GETLATE_API_KEY`, `GETLATE_PINTEREST_ACCOUNT_ID`, `PINTEREST_BOARD_ID`. |

For **Railway**: set `GCP_SERVICE_ACCOUNT_JSON` to the full service account JSON string (no file path). For local dev you can use `GOOGLE_APPLICATION_CREDENTIALS` pointing to a key file.

## Setup

1. **Node**  
   Use Node 18+.

2. **Database**  
   Create a Postgres database (e.g. Railway Postgres). Run the schema:

   ```bash
   psql "$DATABASE_URL" -f sql/schema.sql
   ```

3. **Environment**  
   Copy `.env.example` to `.env` and set all variables.

   - **Required (BigQuery as trends source):** `DATABASE_URL`, `GCP_PROJECT_ID`, and either `GOOGLE_APPLICATION_CREDENTIALS` (path) or `GCP_SERVICE_ACCOUNT_JSON` (JSON string for Railway).  
   - **Required (rest of pipeline):** `OPENAI_*`, `GEMINI_*`, `SHOPIFY_*`, and either Templated.io (`TEMPLATED_*`) and/or Getlate (`GETLATE_*`) and Pinterest (`PINTEREST_BOARD_ID` etc.) — see table above.

4. **Google Trends**  
   Default: `GOOGLE_TRENDS_SOURCE=bigquery` uses the [Google Trends BigQuery dataset](https://support.google.com/trends/answer/12764470) (Top 25 + Top 25 Rising, US). Set `GOOGLE_TRENDS_SOURCE=mcp` and `GOOGLE_TRENDS_MCP_URL` to use an MCP endpoint instead.

5. **APIs**  
   Shopify: Admin API 2024-01. Pinterest: Content API v5 or Getlate. Pin creative: [Templated.io](https://templated.io). Gemini: image-capable model.

## Run locally

```bash
npm install
npm run dev
```

For a dry run (no Shopify/Templated/Pinterest calls):

```bash
DRY_RUN=true npm run dev
```

## Deploy to Railway

1. **Create a project** at [railway.app](https://railway.app) and connect your repo (or use the Railway CLI: `railway link` then `railway up`).

2. **Add Postgres**  
   In the project, add a Postgres service. Railway will set `DATABASE_URL` for your app. Run the schema once (e.g. from your machine):
   ```bash
   psql "$DATABASE_URL" -f sql/schema.sql
   ```

3. **Set environment variables**  
   In the app service → Variables, set all vars from `.env.example`. For Railway you must use `GCP_SERVICE_ACCOUNT_JSON` (paste the full GCP service account JSON string); the app reads `PORT` automatically.

4. **Build and start**  
   Railway will run `npm install`, `npm run build`, and `npm start`. The app listens on `PORT` and runs the content pipeline once on startup. To run on a schedule, use [Railway Cron](https://docs.railway.com/cron-jobs) to redeploy or call an endpoint, or run the app as a cron job service.

## Project layout

- `src/config.ts` – Env validation (Zod)
- `src/workflow/orchestrator.ts` – Main pipeline: topic discovery, content, blog, image, pin, DB writes
- `src/services/` – Google Trends (BigQuery), BoxNCase MCP, OpenAI, Gemini, Templated.io, Getlate, Shopify, Pinterest
- `src/db/` – Pool and queries (topics, posts, pins, assets, runs, logs)
- `sql/schema.sql` – Postgres schema

## Deduplication and logging

- Topics are stored with `primary_keyword` and `status`; once used, the topic is not selected again.
- Each run creates a `runs` row and `logs` rows per step.
- Published posts and pins are stored in `posts` and `pins` with external IDs and URLs.
