# BoxNCase Content Automation – Design & Implementation Plan

**Status:** Design approved; API choices confirmed.  
**Goal:** Production-grade automated flow for SEO blog posts (Shopify) and Pinterest pins (Canva + image generation) with zero manual input.

**Confirmed API choices:**
- **Shopify:** Article creation and meta (title tag, description tag) as implemented – correct.
- **Canva:** **Canva Design API** (Connect APIs at `api.canva.com`) – designs created in Canva; implementation will align with Design API (create design, export job, poll for URL).
- **Pinterest:** **Pinterest API v5** – pin creation; implementation will use v5 payload (including `media_source` and any required fields such as `content_type`).

---

## 1. Architecture (Text Overview)

```
                    +------------------+
                    |  Scheduler/Cron  |
                    |  (daily / Nx/day)|
                    +--------+---------+
                             |
                             v
+----------------------------------------------------------------------------------------------------------+
|                                    ORCHESTRATOR (Pipeline)                                                |
|  Run lifecycle, DB run_id, step logging, error handling, deduplication check, topic selection, ordering   |
+----------------------------------------------------------------------------------------------------------+
     |                |                |                 |                  |                 |
     v                v                v                 v                  v                 v
+----------+   +-------------+   +-------------+   +-------------+   +-------------+   +-------------+
| Topic    |   | Content     |   | Blog        |   | Pin         |   | Canva       |   | Pinterest   |
| Discovery|   | Generation  |   | Publish     |   | Image       |   | Pin         |   | Post        |
+----------+   +-------------+   +-------------+   +-------------+   +-------------+   +-------------+
     |                |                |                 |                  |                 |
     v                v                v                 v                  v                 v
+----------+   +-------------+   +-------------+   +-------------+   +-------------+   +-------------+
| Google   |   | OpenAI      |   | Shopify     |   | Gemini      |   | Canva API   |   | Pinterest   |
| Trends   |   | (chat)      |   | Admin API   |   | (image)     |   |             |   | Content API |
| MCP      |   |             |   |             |   |             |   |             |   |             |
+----------+   +-------------+   +-------------+   +-------------+   +-------------+   +-------------+
     +
+----------+
| BoxNCase |
| MCP      |
+----------+

                              +------------------+
                              |  Postgres DB     |
                              |  runs, topics,   |
                              |  posts, pins,    |
                              |  assets, logs    |
                              +------------------+
```

**Data flow (high level):**

- **Inputs:** Google Trends MCP (trending keywords), BoxNCase MCP (categories, products, B2B keywords).
- **Brain:** Orchestrator selects one primary + 3–5 supporting keywords, checks deduplication, then runs content → blog → image → Canva → Pinterest in sequence.
- **Outputs:** One new Shopify blog article (with canonical URL) and one Pinterest pin (image + copy) linking to that article.
- **State:** All runs, topics, posts, pins, and assets are persisted in Postgres; topic usage prevents repeats.

**Design principles:**

- **Single responsibility per service:** Each module (mcpGoogleTrends, mcpBoxNCase, openaiContent, shopifyBlog, geminiImage, canvaPin, pinterestPin) does one job and is testable in isolation.
- **Orchestrator owns flow and DB:** Only the orchestrator creates runs, logs, topics, posts, pins, assets and decides order; services are stateless and return structured data.
- **Idempotent topic usage:** A topic (primary keyword) is marked used only after the full pipeline succeeds (or after dry run); failed runs do not mark the topic used so it can be retried or picked again by logic later if desired.
- **Scalability:** Adding new categories or filters is a config/script change in topic discovery; adding new output channels (e.g. another social platform) would be a new service + orchestrator step.

---

## 2. Step-by-Step Flow Breakdown

| Step | Name | What happens | Failure behavior |
|------|------|--------------|------------------|
| 0 | **Run start** | Create `runs` row (status `running`), capture `run_id`, log "Pipeline started". | N/A |
| 1 | **Topic discovery** | (1a) GET Google Trends MCP → list of `{ keyword, score?, rising? }`. (1b) GET BoxNCase MCP → categories + products. (1c) Extract context keywords from BoxNCase. (1d) Score trends by industry keywords (food, beverage, wholesale, etc.) + context overlap + rising. (1e) Pick top as primary, next 3–5 as supporting. (1f) Check DB: if primary already used/selected, abort run. (1g) Insert `topics` row (status `selected`), get `topic_id`. | On MCP or DB failure: finalize run as `failed`, log error, rethrow. On no topic selected: finalize run `failed`, exit. |
| 2 | **Content generation** | Call OpenAI with primary + supporting keywords + brand + context summary. Get structured JSON: blog (title, bodyHtml, metaTitle, metaDescription, internalLinkingNotes), pinterest (headline 60–90 chars, description, no hashtags). | On API/parse error: finalize run `failed`, log, rethrow. |
| 3 | **Blog publishing** | If not DRY_RUN: POST to Shopify Admin API (blog articles). Set title, body_html, meta title/description (via metafields or Shopify article meta). Build canonical URL from shop domain + blog handle + article handle. Insert `posts` row; store `shopify_post_id`, canonical_url, meta. | On failure: finalize run `failed`, rethrow. Topic remains `selected` (not used). |
| 4 | **Pin image generation** | Call Gemini Image API with prompt (vertical, lifestyle/food, no fake brands, no text). Receive image (e.g. PNG base64). | On failure: finalize run `failed`, rethrow. |
| 5 | **Canva pin creative** | Send image + Pinterest headline + brand style to Canva API: create design (e.g. 1000×1500), then export. Store resulting image URL. Insert `assets` row (type canva_image, provider canva, storage_url). | On failure: finalize run `failed`, rethrow. |
| 6 | **Pinterest posting** | Create pin via Pinterest API: board_id, title (headline), description, link = canonical blog URL, media = image URL from Canva. Insert `pins` row (post_id, pinterest_pin_id, image_asset_id, title, description, destination_url). Mark topic `used`. | On failure: finalize run `failed`, rethrow. Topic remains `selected` so it can be retried or re-picked by future logic if desired. |
| 7 | **Run end** | Set run status `success`, log "Pipeline finished successfully". | If any step threw: run already finalized as `failed` with error_summary. |

**Dry run:** When `DRY_RUN=true`, skip steps 3–6 (no Shopify, Gemini, Canva, Pinterest calls). Topic is still marked used so it is not selected again; only content generation runs.

**Deduplication:** Before step 2, the orchestrator checks `topics` for `primary_keyword` with status `selected` or `used`. If found, run ends with "Topic already used".

---

## 3. Separation of Responsibilities by Service

| Service / Layer | Responsibility | Does NOT |
|-----------------|----------------|----------|
| **Orchestrator** | Run lifecycle (create/finalize run, log steps); topic scoring and selection; deduplication; calling services in order; persisting topics, posts, assets, pins; marking topic used. | Call MCP/APIs for raw data (delegates to mcp* and *Pin/*Blog); does not contain business logic for scoring beyond simple keyword match (could be moved to a small "topic selector" module later). |
| **mcpGoogleTrends** | HTTP GET to Google Trends MCP URL; parse response to `{ items: [{ keyword, score?, rising? }] }`. | Interpret or filter keywords. |
| **mcpBoxNCase** | HTTP GET to BoxNCase MCP URL; parse categories + products; extract flat list of context keywords (names + optional keywords arrays). | Score or select topics. |
| **openaiContent** | Single OpenAI chat request with structured prompt; return typed object (blog + pinterest copy). | Know about Shopify or Pinterest; generate images. |
| **shopifyBlog** | POST new article to Shopify Admin API; map title, body_html, meta; return id, handle, canonical URL. | Decide canonical URL pattern (orchestrator/caller can override if needed); manage blog list. |
| **geminiImage** | One Gemini generateContent call with image-generation config; return base64 image (and mime type). | Compose with Canva; know Pinterest dimensions. |
| **canvaPin** | Create design from template (or inline elements: image + text), export image, return export URL. | Call Pinterest or Shopify; store assets (orchestrator writes to DB). |
| **pinterestPin** | POST pin to Pinterest API (board, title, description, link, media URL). Return pin id and link. | Fetch or upload image binary (uses URL); manage boards. |
| **DB (queries)** | CRUD for runs, logs, topics, posts, assets, pins. | Business logic; API calls. |
| **Config** | Load and validate env (Zod); expose typed config. | Call any external service. |

---

## 4. APIs, Credentials, and Rate-Limit Considerations

| System | Purpose | Credentials / Config | Rate / Limits | Notes |
|--------|---------|----------------------|---------------|--------|
| **Google Trends MCP** | Trending keywords | `GOOGLE_TRENDS_MCP_URL` (required), `GOOGLE_TRENDS_MCP_TOKEN` (optional) | Unknown; assume 1 GET per run. | Not in Cursor MCP list; implemented as HTTP client to a custom MCP or proxy. Confirm URL and response shape `{ items: [...] }`. |
| **BoxNCase MCP** | Categories, products, B2B keywords | `BOXNCASE_MCP_URL` (required), `BOXNCASE_MCP_TOKEN` (optional) | Unknown; 1 GET per run. | Same: custom HTTP client. Confirm response shape `{ categories, products }` with optional `keywords` arrays. |
| **OpenAI** | Blog + Pinterest copy (one JSON response) | `OPENAI_API_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | Per-account TPM/RPM; 1 request per run, long timeout (e.g. 60s). | Uses `/chat/completions` and `response_format: { type: "json_object" }`. |
| **Shopify Admin API** | Create blog article | `SHOPIFY_ADMIN_API_BASE_URL`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_BLOG_ID`, `SHOPIFY_BLOG_HANDLE` (optional) | 2 req/s (REST), 1000-point bucket; 1 POST per run. | **Confirmed.** Article meta via `metafields_global_title_tag` / `metafields_global_description_tag`. |
| **Gemini** | Pin image generation | `GEMINI_IMAGE_API_URL`, `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` | Gemini image generation has its own quotas (RPM); 1 call per run. | Model must support `responseModalities: ["TEXT","IMAGE"]` and `responseMimeType: "image/png"`. |
| **Canva Design API** | Create + export pin image | `CANVA_API_BASE_URL`, `CANVA_API_KEY`, `CANVA_TEMPLATE_ID` (or design preset) | Exports: 20 create/min; 120 get/min. | **Confirmed: Design API.** Base URL typically `https://api.canva.com/rest/v1`. Create design (`POST /designs` – custom dimensions or from template), then create export job (`POST /exports`), poll `GET /exports/{exportId}` for download URL (valid 24h). Current `canvaPin.ts` is a stub; implement against Design API docs (designs, exports, optional asset upload for Gemini image). |
| **Pinterest API v5** | Create pin | `PINTEREST_API_BASE_URL`, `PINTEREST_ACCESS_TOKEN`, `PINTEREST_BOARD_ID` | Rate limits per app; 1 POST per run. | **Confirmed: v5.** Use `POST /pins` with `media_source: { source_type: "image_url", content_type: "image/png" (or image/jpeg)", url }`. Image URL must be HTTPS. Scopes: `pins:write`, `boards:read`. Current `pinterestPin.ts` may need `content_type` added to match v5. |
| **Postgres** | Runs, topics, posts, pins, assets, logs | `DATABASE_URL` | N/A | Connection pooling; one transaction per run for consistency where needed. |

**Credentials summary (env):**

- Required: `DATABASE_URL`, `GOOGLE_TRENDS_MCP_URL`, `BOXNCASE_MCP_URL`, `OPENAI_*`, `GEMINI_*`, `CANVA_*`, `SHOPIFY_*`, `PINTEREST_*`.
- Optional: `GOOGLE_TRENDS_MCP_TOKEN`, `BOXNCASE_MCP_TOKEN`, `SHOPIFY_BLOG_HANDLE`.
- Behavior: `DRY_RUN`, `MAX_TOPICS_PER_RUN` (currently 1), `RUN_MODE`, `BRAND_NAME`.

---

## 5. Data Schema for Tracking Posts and Pins

Existing schema (already in place) with suggested semantics and optional extensions:

**`runs`**  
- Tracks each pipeline execution: `id`, `scheduled_time`, `started_at`, `finished_at`, `status` (e.g. `running` | `success` | `failed`), `error_summary`, `retry_count`.  
- Use: debugging, monitoring, retries.

**`topics`**  
- One row per selected topic: `id`, `primary_keyword` (unique), `supporting_keywords` (array), `status` (e.g. `selected` | `used`), `selected_at`, `used_at`.  
- Deduplication: do not pick a topic whose `primary_keyword` already has status `selected` or `used`.

**`posts`**  
- One row per published blog article: `id`, `topic_id`, `shopify_post_id`, `title`, `canonical_url`, `meta_title`, `meta_description`, `published_at`, `status`.  
- Links back to topic and to Shopify.

**`assets`**  
- One row per generated image (e.g. Canva export): `id`, `type` (e.g. `canva_image`), `provider` (e.g. `canva`), `storage_url`, `checksum` (optional), `created_at`.  
- Use: audit trail, re-use or re-download of pin images.

**`pins`**  
- One row per Pinterest pin: `id`, `post_id`, `pinterest_pin_id`, `image_asset_id`, `title`, `description`, `destination_url`, `status`, `created_at`.  
- Links pin to post (and thus to canonical URL) and to asset.

**`logs`**  
- Per-step, per-run log: `run_id`, `step`, `level`, `message`, `created_at`.  
- Use: observability and support.

**Optional additions (for later):**

- `runs.next_retry_at` or `runs.retry_after` if you add retry logic.
- `posts.handle` if you want to store Shopify article handle explicitly.
- Indexes: `topics(primary_keyword, status)`, `runs(status, finished_at)`, `posts(topic_id)`, `pins(post_id)` if not already present.

No change to schema is required for the current flow; the above documents existing tables and suggests minor extensions.

---

## 6. Assumptions and Confirmations

- **Shopify:** Confirmed. Article creation and meta (title tag, description tag) as implemented.
- **Gemini:** Model supports image generation (assumed; confirm model id and base URL if needed).
- **Canva:** Confirmed: Canva Design API. Use Connect APIs (create design, export job, poll); implement canvaPin.ts against Design API docs.
- **Pinterest:** **Confirmed:** Pinterest API v5; use media_source (source_type, content_type, url); add content_type in implementation.
- **Scheduling:** External cron; one run per trigger `MAX_TOPICS_PER_RUN=1` (assumed).
- **Canonical URL:** From Shopify hostname + blog handle + article handle (assumed).

---

## 7. Next Step

Implementation can proceed: align Canva with Design API (create design, export job, poll); align Pinterest with v5 (add `content_type` if required); then tests and scheduling. This document remains the single reference for architecture, flow, responsibilities, APIs, and schema.
