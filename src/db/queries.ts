import type { PoolClient } from "pg";

export async function createRun(client: PoolClient, scheduledTime: Date) {
  const result = await client.query(
    `insert into runs (scheduled_time, started_at, status)
     values ($1, now(), 'running')
     returning id`,
    [scheduledTime.toISOString()]
  );
  return result.rows[0].id as number;
}

export async function finalizeRun(
  client: PoolClient,
  runId: number,
  status: "success" | "failed",
  errorSummary?: string
) {
  await client.query(
    `update runs
     set finished_at = now(), status = $2, error_summary = $3
     where id = $1`,
    [runId, status, errorSummary ?? null]
  );
}

export async function logEvent(
  client: PoolClient,
  runId: number,
  step: string,
  level: "debug" | "info" | "warn" | "error",
  message: string
) {
  await client.query(
    `insert into logs (run_id, step, level, message, created_at)
     values ($1, $2, $3, $4, now())`,
    [runId, step, level, message]
  );
}

export async function isTopicUsed(client: PoolClient, keyword: string) {
  const result = await client.query(
    `select 1 from topics
     where primary_keyword = $1
     and status in ('selected', 'used')
     limit 1`,
    [keyword]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getTopicIdByKeyword(
  client: PoolClient,
  primaryKeyword: string
): Promise<number | null> {
  const result = await client.query(
    `select id from topics where primary_keyword = $1 limit 1`,
    [primaryKeyword]
  );
  const row = result.rows[0];
  return row ? (row.id as number) : null;
}

export async function createTopic(
  client: PoolClient,
  primaryKeyword: string,
  supportingKeywords: string[]
) {
  const result = await client.query(
    `insert into topics (primary_keyword, supporting_keywords, status, selected_at)
     values ($1, $2, 'selected', now())
     returning id`,
    [primaryKeyword, supportingKeywords]
  );
  return result.rows[0].id as number;
}

export async function markTopicUsed(client: PoolClient, topicId: number) {
  await client.query(
    `update topics set status = 'used', used_at = now() where id = $1`,
    [topicId]
  );
}

export async function createPost(
  client: PoolClient,
  topicId: number,
  data: {
    shopifyPostId: string;
    title: string;
    canonicalUrl: string;
    metaTitle: string;
    metaDescription: string;
  }
) {
  const result = await client.query(
    `insert into posts
      (topic_id, shopify_post_id, title, canonical_url, meta_title, meta_description, published_at, status)
     values ($1, $2, $3, $4, $5, $6, now(), 'published')
     returning id`,
    [
      topicId,
      data.shopifyPostId,
      data.title,
      data.canonicalUrl,
      data.metaTitle,
      data.metaDescription
    ]
  );
  return result.rows[0].id as number;
}

export async function createAsset(
  client: PoolClient,
  data: {
    type: "raw_image" | "canva_image" | "templated_image";
    provider: "gemini" | "canva" | "templated";
    storageUrl: string;
    checksum?: string;
  }
) {
  const result = await client.query(
    `insert into assets (type, provider, storage_url, checksum, created_at)
     values ($1, $2, $3, $4, now())
     returning id`,
    [data.type, data.provider, data.storageUrl, data.checksum ?? null]
  );
  return result.rows[0].id as number;
}

export async function createPin(
  client: PoolClient,
  data: {
    postId: number;
    pinterestPinId: string;
    imageAssetId: number;
    title: string;
    description: string;
    destinationUrl: string;
    /** Pinterest pin URL (e.g. from Getlate platformPostUrl). */
    platformUrl?: string;
  }
) {
  const result = await client.query(
    `insert into pins
      (post_id, pinterest_pin_id, image_asset_id, title, description, destination_url, platform_url, status, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'published', now())
     returning id`,
    [
      data.postId,
      data.pinterestPinId,
      data.imageAssetId,
      data.title,
      data.description,
      data.destinationUrl,
      data.platformUrl ?? null
    ]
  );
  return result.rows[0].id as number;
}
