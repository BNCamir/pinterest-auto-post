import { requestJson } from "../http.js";

export type CreateArticleInput = {
  title: string;
  bodyHtml: string;
  /** Optional featured image URL (Shopify will download and attach to the article). */
  imageUrl?: string;
  imageAlt?: string;
  metafields?: Array<{ key: string; namespace: string; value: string; type: string }>;
};

export type ShopifyArticle = {
  id: string;
  title: string;
  handle: string;
  admin_graphql_api_id: string;
};

export async function createBlogArticle(input: {
  baseUrl: string;
  accessToken: string;
  blogId: string;
  blogHandle?: string;
  /** Public store origin for article URLs (e.g. https://www.yourstore.com). If unset, uses admin API hostname. */
  publicStoreOrigin?: string;
  article: CreateArticleInput;
}): Promise<{ id: string; handle: string; url: string }> {
  // baseUrl already includes /admin/api/2024-01, so just add the blogs path
  const path = `/blogs/${input.blogId}/articles.json`;
  const url = input.baseUrl.replace(/\/$/, "") + path;

  const articleBody: Record<string, unknown> = {
    title: input.article.title,
    body_html: input.article.bodyHtml
  };

  if (input.article.imageUrl) {
    articleBody.image = {
      src: input.article.imageUrl,
      alt: input.article.imageAlt ?? input.article.title
    };
  }

  // Add metafields only if provided (legacy format - may not work in all API versions)
  const titleTag = input.article.metafields?.find(
    (m) => m.key === "title_tag" && m.namespace === "global"
  )?.value;
  const descTag = input.article.metafields?.find(
    (m) => m.key === "description_tag" && m.namespace === "global"
  )?.value;

  if (titleTag) {
    articleBody.metafields_global_title_tag = titleTag;
  }
  if (descTag) {
    articleBody.metafields_global_description_tag = descTag;
  }

  const body = { article: articleBody };

  let response: { article: ShopifyArticle };
  try {
    response = await requestJson<{ article: ShopifyArticle }>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": input.accessToken
      },
      body: JSON.stringify(body),
      timeoutMs: 30000
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Shopify API request failed:", {
      url,
      blogId: input.blogId,
      body: JSON.stringify(body, null, 2),
      error: errorMessage
    });
    throw err;
  }

  const article = response.article;
  if (!article?.id) throw new Error("Shopify did not return article id");

  const blogHandle = input.blogHandle ?? "news";
  const origin = input.publicStoreOrigin?.replace(/\/$/, "")
    ?? `https://${new URL(input.baseUrl).hostname}`;
  const canonicalUrl = `${origin}/blogs/${blogHandle}/${article.handle}`;

  return {
    id: String(article.id),
    handle: article.handle,
    url: canonicalUrl
  };
}
