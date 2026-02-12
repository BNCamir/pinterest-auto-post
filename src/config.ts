import { z } from "zod";

const booleanSchema = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(["true", "false"]))
  .transform((v) => v === "true");

const configSchema = z.object({
  NODE_ENV: z.string().default("production"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  RUN_MODE: z.string().default("cron"),
  DRY_RUN: booleanSchema.default("false"),
  MAX_TOPICS_PER_RUN: z.string().default("1").transform((v) => Number.parseInt(v, 10)),
  BRAND_NAME: z.string().default("BoxNCase"),
  ALLOW_TOPIC_REUSE: booleanSchema.optional(),
  GOOGLE_TRENDS_SOURCE: z.enum(["bigquery", "mcp", "searchapi_food"]).default("bigquery"),
  GOOGLE_TRENDS_MCP_URL: z.string().optional(),
  GOOGLE_TRENDS_MCP_TOKEN: z.string().optional(),
  SEARCHAPI_API_KEY: z.string().optional(),
  GCP_PROJECT_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GCP_SERVICE_ACCOUNT_JSON: z.string().optional(),
  BOXNCASE_MCP_URL: z.string().optional(),
  BOXNCASE_MCP_TOKEN: z.string().optional(),
  OPENAI_API_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  GEMINI_IMAGE_API_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  /** Default to supported model; gemini-2.0-flash-exp is deprecated. */
  GEMINI_IMAGE_MODEL: z
    .string()
    .optional()
    .transform((v) => (v === "gemini-2.0-flash-exp" ? "gemini-2.5-flash-image" : v)),
  CANVA_API_BASE_URL: z.string().optional(),
  CANVA_API_KEY: z.string().optional(),
  CANVA_TEMPLATE_ID: z.string().optional(),
  TEMPLATED_API_KEY: z.string().optional(),
  TEMPLATED_TEMPLATE_ID: z.string().optional(),
  /** Comma-separated template IDs to rotate. If set, one is picked per run. */
  TEMPLATED_TEMPLATE_IDS: z.string().optional(),
  /** For multi-page templates: number of pages (e.g. 10). Each run renders one page: runId % TEMPLATED_PAGE_COUNT. */
  TEMPLATED_PAGE_COUNT: z.string().optional().transform((v) => (v ? Number.parseInt(v, 10) : undefined)),
  GETLATE_API_KEY: z.string().optional(),
  GETLATE_PINTEREST_ACCOUNT_ID: z.string().optional(),
  SHOPIFY_ADMIN_API_BASE_URL: z.string().optional(),
  SHOPIFY_ACCESS_TOKEN: z.string().optional(),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  SHOPIFY_STORE: z.string().optional(),
  SHOPIFY_BLOG_ID: z.string().optional(),
  SHOPIFY_BLOG_HANDLE: z.string().optional(),
  SHOPIFY_PUBLIC_STORE_URL: z.string().optional(),
  PINTEREST_API_BASE_URL: z.string().optional(),
  PINTEREST_ACCESS_TOKEN: z.string().optional(),
  PINTEREST_BOARD_ID: z.string().optional()
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  const config = parsed.data;

  if (config.GOOGLE_TRENDS_SOURCE === "bigquery") {
    if (!config.GCP_PROJECT_ID?.trim()) {
      throw new Error("GCP_PROJECT_ID is required when GOOGLE_TRENDS_SOURCE=bigquery");
    }
    if (!config.GOOGLE_APPLICATION_CREDENTIALS?.trim() && !config.GCP_SERVICE_ACCOUNT_JSON?.trim()) {
      throw new Error(
        "Set GOOGLE_APPLICATION_CREDENTIALS (path) or GCP_SERVICE_ACCOUNT_JSON (JSON string) when GOOGLE_TRENDS_SOURCE=bigquery"
      );
    }
  } else if (config.GOOGLE_TRENDS_SOURCE === "searchapi_food") {
    if (!config.SEARCHAPI_API_KEY?.trim()) {
      throw new Error("SEARCHAPI_API_KEY is required when GOOGLE_TRENDS_SOURCE=searchapi_food");
    }
  } else {
    if (!config.GOOGLE_TRENDS_MCP_URL?.trim()) {
      throw new Error("GOOGLE_TRENDS_MCP_URL is required when GOOGLE_TRENDS_SOURCE=mcp");
    }
  }

  if (!config.DRY_RUN) {
    if (!config.SHOPIFY_ADMIN_API_BASE_URL?.trim() || !config.SHOPIFY_BLOG_ID?.trim()) {
      throw new Error("SHOPIFY_ADMIN_API_BASE_URL and SHOPIFY_BLOG_ID are required when DRY_RUN is false");
    }
    const hasShopifyToken = !!config.SHOPIFY_ACCESS_TOKEN?.trim();
    const hasShopifyClient =
      !!config.SHOPIFY_CLIENT_ID?.trim() && !!config.SHOPIFY_CLIENT_SECRET?.trim() && !!config.SHOPIFY_STORE?.trim();
    if (!hasShopifyToken && !hasShopifyClient) {
      throw new Error(
        "Set SHOPIFY_ACCESS_TOKEN or (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET + SHOPIFY_STORE) when DRY_RUN is false"
      );
    }
    const useGetlate = !!config.GETLATE_API_KEY?.trim();
    const useTemplated =
      !!config.TEMPLATED_API_KEY?.trim() &&
      (!!config.TEMPLATED_TEMPLATE_ID?.trim() || !!config.TEMPLATED_TEMPLATE_IDS?.trim());
    if (useGetlate && !config.GETLATE_PINTEREST_ACCOUNT_ID?.trim()) {
      throw new Error("GETLATE_PINTEREST_ACCOUNT_ID is required when GETLATE_API_KEY is set");
    }
    if (!useGetlate && !useTemplated) {
      if (!config.GEMINI_IMAGE_API_URL?.trim() || !config.GEMINI_API_KEY?.trim() || !config.GEMINI_IMAGE_MODEL?.trim()) {
        throw new Error("GEMINI_* is required when not using Getlate or Templated");
      }
      if (!config.PINTEREST_API_BASE_URL?.trim() || !config.PINTEREST_ACCESS_TOKEN?.trim() || !config.PINTEREST_BOARD_ID?.trim()) {
        throw new Error("PINTEREST_* is required when not using Getlate");
      }
    }
    if (useGetlate) {
      if (!config.PINTEREST_BOARD_ID?.trim()) {
        throw new Error("PINTEREST_BOARD_ID is required when using Getlate");
      }
    }
  }

  return config;
}
