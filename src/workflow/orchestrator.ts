import { join } from "path";
import { existsSync } from "fs";
import type { AppConfig } from "../config.js";
import { withClient } from "../db/index.js";
import * as db from "../db/queries.js";
import { log } from "../logger.js";
import { fetchTrendsFromBigQuery } from "../services/googleTrendsBigQuery.js";
import { fetchTrendingKeywords } from "../services/mcpGoogleTrends.js";
import { fetchFoodDrinkTrendsFromSearchApi } from "../services/searchApiGoogleTrends.js";
import { fetchBoxNCaseContext, extractContextKeywords } from "../services/mcpBoxNCase.js";
import { generateContent } from "../services/openaiContent.js";
import { generatePinImage, improveImageWithGemini, addTextToLocalTemplate, sanitizeHeadline } from "../services/geminiImage.js";
import { getLocalTemplatePath } from "../services/localTemplates.js";
import { createPinFromTemplate } from "../services/canvaPin.js";
import { createPinFromTemplated } from "../services/templated.js";
import { getShopifyAccessToken } from "../services/shopifyToken.js";
import { createBlogArticle } from "../services/shopifyBlog.js";
import { createPin as createPinterestPin } from "../services/pinterestPin.js";
import { createPinViaGetlate, reuploadImageUrlToGetlate, uploadImageToGetlate } from "../services/getlatePin.js";

const INDUSTRY_KEYWORDS = [
  "food",
  "beverage",
  "beverages",
  "snacks",
  "wholesale",
  "hospitality",
  "office",
  "events",
  "catering",
  "bulk",
  "commercial",
  "b2b"
];

const MAX_TOPIC_CANDIDATES = 10;

/** Pick template ID and optional page index. Multi-page: use TEMPLATED_PAGE_COUNT and rotate by runId. */
function getTemplatedOptions(config: AppConfig, runId: number): { templateId: string; pageIndex?: number } {
  const templateId =
    config.TEMPLATED_TEMPLATE_IDS?.trim()
      ? (() => {
          const list = config.TEMPLATED_TEMPLATE_IDS!.split(",").map((s) => s.trim()).filter(Boolean);
          if (list.length > 0) return list[runId % list.length]!;
          return config.TEMPLATED_TEMPLATE_ID?.trim();
        })()
      : config.TEMPLATED_TEMPLATE_ID?.trim();
  if (!templateId) throw new Error("Set TEMPLATED_TEMPLATE_ID or TEMPLATED_TEMPLATE_IDS");
  const pageCount = config.TEMPLATED_PAGE_COUNT;
  const pageIndex = pageCount != null && pageCount > 0 ? runId % pageCount : undefined;
  return { templateId, pageIndex };
}

function scoreAndSelectTopicCandidates(
  trends: { keyword: string; score?: number; rising?: boolean }[],
  contextKeywords: string[]
): { primary: string; supporting: string[] }[] {
  const scored = trends
    .filter((t) => {
      const kw = t.keyword.toLowerCase();
      // Strict filtering: MUST match industry OR context.
      // We no longer allow purely "rising" trends if they are irrelevant.
      const matchesIndustry = INDUSTRY_KEYWORDS.some((i) => kw.includes(i));
      const matchesContext = contextKeywords.some((c) => kw.includes(c) || c.includes(kw));
      return matchesIndustry || matchesContext;
    })
    .map((t) => {
      const kw = t.keyword.toLowerCase();
      const inIndustry = INDUSTRY_KEYWORDS.some((i) => kw.includes(i));
      const inContext = contextKeywords.some((c) => kw.includes(c) || c.includes(kw));
      // Base score is trend score or 0
      const score = (t.score ?? 0) + (t.rising ? 20 : 0) + (inIndustry ? 10 : 0) + (inContext ? 10 : 0);
      return { keyword: t.keyword, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];
  const take = Math.min(MAX_TOPIC_CANDIDATES, scored.length);
  const candidates: { primary: string; supporting: string[] }[] = [];
  for (let i = 0; i < take; i++) {
    const primary = scored[i].keyword;
    const supporting = scored
      .filter((_, j) => j !== i)
      .slice(0, 5)
      .map((s) => s.keyword);
    candidates.push({ primary, supporting });
  }
  return candidates;
}

export async function runPipeline(config: AppConfig, scheduledTime: Date): Promise<void> {
  const runId = await withClient(config.DATABASE_URL, async (client) => {
    const id = await db.createRun(client, scheduledTime);
    await db.logEvent(client, id, "orchestrator", "info", "Pipeline started");
    return id;
  });

  const runLog = (step: string, level: "info" | "warn" | "error", message: string) => {
    log(level, message, { runId, step });
    return withClient(config.DATABASE_URL, (client) =>
      db.logEvent(client, runId, step, level, message)
    );
  };

  try {
    if (config.DRY_RUN) {
      await runLog("orchestrator", "info", "DRY_RUN enabled; skipping external calls");
    }

    const trends =
      config.GOOGLE_TRENDS_SOURCE === "bigquery"
        ? await fetchTrendsFromBigQuery({
          projectId: config.GCP_PROJECT_ID!,
          keyFilename: config.GOOGLE_APPLICATION_CREDENTIALS || undefined,
          credentialsJson: config.GCP_SERVICE_ACCOUNT_JSON || undefined,
          topLimit: 25,
          includeRising: true
        }).catch((err) => {
          throw new Error(`Google Trends BigQuery failed: ${(err as Error).message}`);
        })
        : config.GOOGLE_TRENDS_SOURCE === "searchapi_food"
          ? await fetchFoodDrinkTrendsFromSearchApi({
            apiKey: config.SEARCHAPI_API_KEY!,
            geo: "US",
            timeoutMs: 15000
          }).catch((err) => {
            throw new Error(`SearchApi Food & Drink trends failed: ${(err as Error).message}`);
          })
          : await fetchTrendingKeywords({
            url: config.GOOGLE_TRENDS_MCP_URL!,
            token: config.GOOGLE_TRENDS_MCP_TOKEN,
            timeoutMs: 15000
          }).catch((err) => {
            throw new Error(`Google Trends MCP failed: ${(err as Error).message}`);
          });
    await runLog("topic_discovery", "info", `Fetched ${trends.length} trend items (source=${config.GOOGLE_TRENDS_SOURCE})`);

    const contextKeywords = config.BOXNCASE_MCP_URL?.trim()
      ? extractContextKeywords(
        await fetchBoxNCaseContext({
          url: config.BOXNCASE_MCP_URL,
          token: config.BOXNCASE_MCP_TOKEN,
          timeoutMs: 15000
        }).catch((err) => {
          throw new Error(`BoxNCase MCP failed: ${(err as Error).message}`);
        })
      )
      : [];
    await runLog("topic_discovery", "info", `Context keywords: ${contextKeywords.length}`);

    let candidates = scoreAndSelectTopicCandidates(trends, contextKeywords);
    if (candidates.length === 0 && trends.length > 0) {
      await runLog("topic_discovery", "info", "No industry match; using all trends as fallback for this run");
      for (let i = 0; i < trends.length; i++) {
        const primary = trends[i].keyword;
        const supporting = trends.filter((_, j) => j !== i).slice(0, 5).map((t) => t.keyword);
        candidates.push({ primary, supporting });
      }
    }
    if (candidates.length === 0) {
      await withClient(config.DATABASE_URL, (client) =>
        db.finalizeRun(client, runId, "failed", "No topic selected after scoring")
      );
      await runLog("topic_discovery", "warn", "No topic selected");
      return;
    }

    let selected: { primary: string; supporting: string[] } | null = null;
    if (config.ALLOW_TOPIC_REUSE) {
      selected = candidates[0];
      await runLog("topic_discovery", "info", `ALLOW_TOPIC_REUSE: selected first candidate: ${selected.primary}`);
    } else {
      for (const c of candidates) {
        const used = await withClient(config.DATABASE_URL, (client) => db.isTopicUsed(client, c.primary));
        if (!used) {
          selected = c;
          break;
        }
        await runLog("topic_discovery", "info", `Topic already used, skipping: ${c.primary}`);
      }
      if (!selected) {
        await withClient(config.DATABASE_URL, (client) =>
          db.finalizeRun(client, runId, "failed", "All candidate topics already used")
        );
        await runLog("topic_discovery", "warn", "All candidate topics already used");
        return;
      }
    }

    const topicId = await withClient(config.DATABASE_URL, async (client) => {
      if (config.ALLOW_TOPIC_REUSE) {
        const existing = await db.getTopicIdByKeyword(client, selected.primary);
        if (existing != null) return existing;
      }
      return db.createTopic(client, selected.primary, selected.supporting);
    });
    await runLog("topic_discovery", "info", `Selected topic: ${selected.primary} (id=${topicId})`);

    const content = await generateContent({
      apiUrl: config.OPENAI_API_URL,
      apiKey: config.OPENAI_API_KEY,
      model: config.OPENAI_MODEL,
      primaryKeyword: selected.primary,
      supportingKeywords: selected.supporting,
      brandName: config.BRAND_NAME,
      contextSummary: contextKeywords.slice(0, 20).join(", ")
    }).catch((err) => {
      throw new Error(`OpenAI content failed: ${(err as Error).message}`);
    });
    await runLog("content_generation", "info", "Generated blog and Pinterest copy");
    content.pinterest.headline = sanitizeHeadline(content.pinterest.headline);

    if (!config.DRY_RUN) {
      const useCanva = false; // DEPRECATED
      const useTemplated = !!(
        config.TEMPLATED_API_KEY?.trim() && config.TEMPLATED_TEMPLATE_ID?.trim()
      );
      const useGetlate = !!config.GETLATE_API_KEY?.trim();

      let imageResult: { imageDataBase64: string; mimeType: string } | undefined;
      let imageUrlForBlog: string | undefined;
      let usedTemplatedForImage = false;

      if (useGetlate && !useCanva) {
        // Try local templates first (no initial Gemini image needed - templates already have food imagery)
        const localTemplatePath = await getLocalTemplatePath(runId);
        if (localTemplatePath) {
          await runLog("pin_creative", "info", `Using local template: ${localTemplatePath}`);
          try {
            // Get logo path if available
            const logoPath = join(process.cwd(), "assets", "logo.png");
            const logoExists = existsSync(logoPath);
            
            const templateWithText = await addTextToLocalTemplate({
              apiUrl: config.GEMINI_IMAGE_API_URL!,
              apiKey: config.GEMINI_API_KEY!,
              model: config.GEMINI_IMAGE_MODEL!,
              templatePath: localTemplatePath,
              headline: content.pinterest.headline,
              brandName: config.BRAND_NAME,
              logoPath: logoExists ? logoPath : undefined
            });
            imageUrlForBlog = await uploadImageToGetlate(
              config.GETLATE_API_KEY!,
              templateWithText.imageDataBase64,
              templateWithText.mimeType ?? "image/png"
            );
            await runLog("pin_creative", "info", `Using local template with Gemini-added text: ${imageUrlForBlog}`);
            usedTemplatedForImage = true; // Mark as using template
          } catch (err) {
            await runLog("pin_creative", "warn", `Local template failed (${(err as Error).message}), falling back to Templated.io or raw image`);
          }
        }

        // Fallback: generate Gemini image only when not using local template
        if (!usedTemplatedForImage) {
          imageResult = await generatePinImage({
            apiUrl: config.GEMINI_IMAGE_API_URL!,
            apiKey: config.GEMINI_API_KEY!,
            model: config.GEMINI_IMAGE_MODEL!,
            primaryKeyword: selected.primary,
            brandName: config.BRAND_NAME
          }).catch((err) => {
            throw new Error(`Gemini image failed: ${(err as Error).message}`);
          });
          await runLog("pin_creative", "info", "Generated pin image");
          imageUrlForBlog = await uploadImageToGetlate(
            config.GETLATE_API_KEY!,
            imageResult.imageDataBase64,
            imageResult.mimeType ?? "image/png"
          );
          await runLog("pin_creative", "info", "Uploaded image to Getlate for blog and pin");
        }

        // Fallback to Templated.io if local templates didn't work
        if (!usedTemplatedForImage && useTemplated && imageUrlForBlog) {
          const { templateId, pageIndex } = getTemplatedOptions(config, runId);
          if (pageIndex !== undefined) {
            await runLog("pin_creative", "info", `Using Templated template ${templateId}, page ${pageIndex + 1} of ${config.TEMPLATED_PAGE_COUNT} (runId ${runId} % ${config.TEMPLATED_PAGE_COUNT} = ${pageIndex})`);
          } else {
            await runLog("pin_creative", "warn", `Templated page rotation disabled (TEMPLATED_PAGE_COUNT not set). Using default page/all pages.`);
          }
          const templatedResult = await createPinFromTemplated({
            apiKey: config.TEMPLATED_API_KEY!,
            templateId,
            imageUrl: imageUrlForBlog,
            headline: content.pinterest.headline,
            brandName: config.BRAND_NAME,
            ...(pageIndex !== undefined && { pageIndex })
          }).catch(async (err) => {
            await runLog("pin_creative", "warn", `Templated.io failed (${(err as Error).message}), using raw image for blog and pin`);
            return null;
          });
          if (templatedResult) {
            usedTemplatedForImage = true;
            await runLog("pin_creative", "info", `Templated image generated: ${templatedResult.renderUrl}`);
            await runLog("pin_creative", "info", "Sending Templated image to Gemini for improvement...");
            
            // Improve the Templated image with Gemini
            // Strategy: Recreate from scratch using original food image + headline (better than fixing broken template)
            let improvedImage: { imageDataBase64: string; mimeType: string } | null = null;
            try {
              improvedImage = await improveImageWithGemini({
                apiUrl: config.GEMINI_IMAGE_API_URL!,
                apiKey: config.GEMINI_API_KEY!,
                model: config.GEMINI_IMAGE_MODEL!,
                imageUrl: templatedResult.renderUrl,
                originalFoodImageUrl: imageUrlForBlog, // Use original Gemini food image to recreate
                headline: content.pinterest.headline,
                brandName: config.BRAND_NAME
              });
              await runLog("pin_creative", "info", "Gemini recreation successful, received clean pin image");
            } catch (err) {
              const errorMsg = (err as Error).message;
              await runLog("pin_creative", "error", `Gemini image recreation FAILED: ${errorMsg}`);
              console.error("[Gemini Recreation Error]", err);
              // Continue to fallback below
            }

            if (improvedImage) {
              // Upload improved image to Getlate
              await runLog("pin_creative", "info", "Uploading Gemini-improved image to Getlate...");
              imageUrlForBlog = await uploadImageToGetlate(
                config.GETLATE_API_KEY!,
                improvedImage.imageDataBase64,
                improvedImage.mimeType ?? "image/png"
              );
              await runLog("pin_creative", "info", `Using Gemini-improved image for blog and pin: ${imageUrlForBlog}`);
            } else {
              // Fallback: re-upload Templated image to Getlate
              await runLog("pin_creative", "warn", "FALLBACK: Using Templated image without Gemini improvement");
              const sameImageUrl = await reuploadImageUrlToGetlate(
                config.GETLATE_API_KEY!,
                templatedResult.renderUrl
              ).catch(async (err) => {
                await runLog("pin_creative", "warn", `Re-upload Templated to Getlate failed (${(err as Error).message}), using Templated URL`);
                return templatedResult.renderUrl;
              });
              imageUrlForBlog = sameImageUrl;
              await runLog("pin_creative", "warn", `Using unimproved Templated image: ${imageUrlForBlog}`);
            }
          }
        }
      }

      const shopifyAccessToken = await getShopifyAccessToken(config);
      const shopifyResult = await createBlogArticle({
        baseUrl: config.SHOPIFY_ADMIN_API_BASE_URL!,
        accessToken: shopifyAccessToken,
        blogId: config.SHOPIFY_BLOG_ID!,
        blogHandle: config.SHOPIFY_BLOG_HANDLE,
        publicStoreOrigin: config.SHOPIFY_PUBLIC_STORE_URL?.trim() || undefined,
        article: {
          title: content.blog.title,
          bodyHtml: content.blog.bodyHtml,
          imageUrl: imageUrlForBlog,
          imageAlt: content.blog.title,
          metafields: [
            { namespace: "global", key: "title_tag", value: content.blog.metaTitle, type: "single_line_text_field" },
            { namespace: "global", key: "description_tag", value: content.blog.metaDescription, type: "single_line_text_field" }
          ]
        }
      }).catch((err) => {
        throw new Error(`Shopify publish failed: ${(err as Error).message}`);
      });
      await runLog("blog_publish", "info", `Published: ${shopifyResult.url}`);

      const postId = await withClient(config.DATABASE_URL, (client) =>
        db.createPost(client, topicId, {
          shopifyPostId: shopifyResult.id,
          title: content.blog.title,
          canonicalUrl: shopifyResult.url,
          metaTitle: content.blog.metaTitle,
          metaDescription: content.blog.metaDescription
        })
      );

      if (!imageUrlForBlog && !imageResult) {
        imageResult = await generatePinImage({
          apiUrl: config.GEMINI_IMAGE_API_URL!,
          apiKey: config.GEMINI_API_KEY!,
          model: config.GEMINI_IMAGE_MODEL!,
          primaryKeyword: selected.primary,
          brandName: config.BRAND_NAME
        }).catch((err) => {
          throw new Error(`Gemini image failed: ${(err as Error).message}`);
        });
        await runLog("pin_creative", "info", "Generated pin image");
      }

      let assetId: number;
      let pinResult: { id: string; link: string; title: string } | undefined;

      if (useGetlate) {
        await runLog("pin_creative", "info", "Using Getlate for Pinterest");
        assetId = await withClient(config.DATABASE_URL, (client) =>
          db.createAsset(client, {
            type: usedTemplatedForImage ? "templated_image" : "raw_image",
            provider: usedTemplatedForImage ? "templated" : "gemini",
            storageUrl: imageUrlForBlog ?? "gemini-inline"
          })
        );
        pinResult = await createPinViaGetlate({
          apiKey: config.GETLATE_API_KEY!,
          accountId: config.GETLATE_PINTEREST_ACCOUNT_ID!,
          boardId: config.PINTEREST_BOARD_ID!,
          title: content.pinterest.headline,
          description: content.pinterest.description,
          link: shopifyResult.url,
          ...(imageUrlForBlog
            ? { imageUrl: imageUrlForBlog }
            : { imageBase64: imageResult!.imageDataBase64, imageContentType: imageResult!.mimeType ?? "image/png" })
        }).catch((err) => {
          throw new Error(`Getlate pin failed: ${(err as Error).message}`);
        });
      } else if (useTemplated) {
        if (!imageResult) throw new Error("Templated path requires generated image");
        const imageUrlForTemplated =
          config.GETLATE_API_KEY?.trim()
            ? await uploadImageToGetlate(
                config.GETLATE_API_KEY!,
                imageResult.imageDataBase64,
                imageResult.mimeType ?? "image/png"
              ).catch(() => null)
            : null;
        if (!imageUrlForTemplated) {
          throw new Error("Templated.io needs image_url. Set GETLATE_API_KEY to upload the image and get a URL.");
        }
        const { templateId, pageIndex } = getTemplatedOptions(config, runId);
        const templatedResult = await createPinFromTemplated({
          apiKey: config.TEMPLATED_API_KEY!,
          templateId,
          imageUrl: imageUrlForTemplated,
          headline: content.pinterest.headline,
          brandName: config.BRAND_NAME,
          ...(pageIndex !== undefined && { pageIndex })
        }).catch((err) => {
          throw new Error(`Templated.io pin failed: ${(err as Error).message}`);
        });

        assetId = await withClient(config.DATABASE_URL, (client) =>
          db.createAsset(client, {
            type: "templated_image",
            provider: "templated",
            storageUrl: templatedResult.renderUrl
          })
        );
        pinResult = await createPinterestPin({
          baseUrl: config.PINTEREST_API_BASE_URL!,
          accessToken: config.PINTEREST_ACCESS_TOKEN!,
          boardId: config.PINTEREST_BOARD_ID!,
          title: content.pinterest.headline,
          description: content.pinterest.description,
          link: shopifyResult.url,
          imageUrl: templatedResult.renderUrl
        }).catch((err) => {
          throw new Error(`Pinterest post failed: ${(err as Error).message}`);
        });
      } else {
        if (!imageResult) throw new Error("Direct Pinterest path requires generated image");
        await runLog("pin_creative", "info", "Skipping Canva (no template/key); using Gemini image for pin");
        assetId = await withClient(config.DATABASE_URL, (client) =>
          db.createAsset(client, {
            type: "raw_image",
            provider: "gemini",
            storageUrl: "gemini-inline"
          })
        );
        pinResult = await createPinterestPin({
          baseUrl: config.PINTEREST_API_BASE_URL!,
          accessToken: config.PINTEREST_ACCESS_TOKEN!,
          boardId: config.PINTEREST_BOARD_ID!,
          title: content.pinterest.headline,
          description: content.pinterest.description,
          link: shopifyResult.url,
          imageBase64: imageResult.imageDataBase64,
          imageContentType: imageResult.mimeType ?? "image/png"
        }).catch((err) => {
          throw new Error(`Pinterest post failed: ${(err as Error).message}`);
        });
      }
      if (!pinResult) {
        throw new Error("Pin logic failed to produce a result (pinResult undefined)");
      }
      await runLog("pinterest_post", "info", `Pin created: ${pinResult.id}`);
      await runLog("pinterest_post", "info", `Pin URL: ${pinResult.link}`);

      await withClient(config.DATABASE_URL, async (client) => {
        await db.createPin(client, {
          postId,
          pinterestPinId: pinResult.id,
          imageAssetId: assetId,
          title: content.pinterest.headline,
          description: content.pinterest.description,
          destinationUrl: shopifyResult.url,
          platformUrl: pinResult.link
        });
        await db.markTopicUsed(client, topicId);
      });
    } else {
      await withClient(config.DATABASE_URL, (client) => db.markTopicUsed(client, topicId));
    }

    await withClient(config.DATABASE_URL, (client) =>
      db.finalizeRun(client, runId, "success")
    );
    await runLog("orchestrator", "info", "Pipeline finished successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withClient(config.DATABASE_URL, (client) =>
      db.finalizeRun(client, runId, "failed", message)
    ).catch(() => { });
    await runLog("orchestrator", "error", message);
    throw err;
  }
}
