/**
 * Create Pinterest pins via Getlate (Late) API.
 * When using Getlate, connect your Pinterest in the Getlate dashboard and use GETLATE_PINTEREST_ACCOUNT_ID.
 * Pinterest limits: title 100 chars, description 500 chars, link valid URL.
 */

const GETLATE_API_BASE = "https://getlate.dev/api/v1";

/** Pinterest pin limits to avoid "Invalid URL or request data" from platform. */
const PINTEREST_TITLE_MAX = 100;
const PINTEREST_DESCRIPTION_MAX = 500;
const PINTEREST_LINK_MAX = 2048;

/** Remove control chars and normalize for Pinterest/JSON. */
function cleanText(s: string): string {
  return s.replace(/[\0-\x1F\x7F]/g, "").trim();
}

function sanitizeForPinterest(input: CreatePinViaGetlateInput): CreatePinViaGetlateInput {
  const title = cleanText(input.title ?? "").slice(0, PINTEREST_TITLE_MAX);
  const description = cleanText(input.description ?? "").slice(0, PINTEREST_DESCRIPTION_MAX);
  let link = cleanText(input.link ?? "");
  if (!link || link.length === 0) {
    throw new Error("Pin destination link is required (e.g. blog article URL)");
  }
  if (link.length > PINTEREST_LINK_MAX) link = link.slice(0, PINTEREST_LINK_MAX);
  if (!link.startsWith("http://") && !link.startsWith("https://")) {
    throw new Error(`Pin link must be a valid HTTP(S) URL, got: ${link.slice(0, 50)}...`);
  }
  let boardId = (input.boardId ?? "").trim();
  if (!boardId) {
    throw new Error("Pinterest board ID is required and cannot be empty");
  }
  // If boardId is a full Pinterest URL, extract just the board name/ID
  // e.g. "https://pinterest.com/username/board-name" -> "username/board-name"
  // or "https://www.pinterest.com/username/board-name/" -> "username/board-name"
  try {
    const boardUrl = new URL(boardId);
    if (boardUrl.hostname.includes("pinterest.com")) {
      const pathParts = boardUrl.pathname.split("/").filter(Boolean);
      if (pathParts.length >= 2) {
        boardId = `${pathParts[0]}/${pathParts[1]}`;
      } else if (pathParts.length === 1) {
        boardId = pathParts[0]!;
      }
    }
  } catch {
    // Not a URL, assume it's already a board ID/name
  }
  return { ...input, title, description, link, boardId };
}

export type CreatePinViaGetlateInput = {
  apiKey: string;
  accountId: string;
  boardId: string;
  title: string;
  description: string;
  link: string;
  /** Public image URL (e.g. from Canva export) */
  imageUrl?: string;
  /** Or upload from base64 via Getlate media presign */
  imageBase64?: string;
  imageContentType?: string;
};

export type GetlatePinResult = {
  id: string;
  link: string;
  title: string;
};

/**
 * Get a presigned URL from Getlate, upload raw bytes, return public URL.
 * Exported so the orchestrator can use the same URL for blog featured image and pin.
 */
export async function uploadImageToGetlate(
  apiKey: string,
  imageBase64: string,
  contentType: string
): Promise<string> {
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const res = await fetch(`${GETLATE_API_BASE}/media/presign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filename: `pin-${Date.now()}.${ext}`,
      contentType: contentType.startsWith("image/") ? contentType : "image/png"
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Getlate presign failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { uploadUrl: string; publicUrl: string };
  const bytes = Buffer.from(imageBase64, "base64");
  const mime = contentType.startsWith("image/") ? contentType : "image/png";
  const putRes = await fetch(data.uploadUrl, {
    method: "PUT",
    body: bytes,
    headers: { "Content-Type": mime }
  });
  if (!putRes.ok) {
    throw new Error(`Getlate upload failed: ${putRes.status}`);
  }
  return data.publicUrl;
}

/**
 * Fetch an image from a URL and re-upload to Getlate. Use this so the pin image URL is
 * Getlate-hosted (Pinterest often rejects third-party image URLs with "Invalid URL or request data").
 */
export async function reuploadImageUrlToGetlate(
  apiKey: string,
  imageUrl: string
): Promise<string> {
  const res = await fetch(imageUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch image for re-upload: ${res.status} ${imageUrl.slice(0, 60)}...`);
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const buf = await res.arrayBuffer();
  const base64 = Buffer.from(buf).toString("base64");
  return uploadImageToGetlate(apiKey, base64, contentType);
}

export async function createPinViaGetlate(input: CreatePinViaGetlateInput): Promise<GetlatePinResult> {
  const sanitized = sanitizeForPinterest(input);
  let imageUrl = sanitized.imageUrl;
  if (!imageUrl && sanitized.imageBase64) {
    imageUrl = await uploadImageToGetlate(
      sanitized.apiKey,
      sanitized.imageBase64,
      sanitized.imageContentType ?? "image/png"
    );
  }
  if (!imageUrl) {
    throw new Error("createPinViaGetlate requires imageUrl or imageBase64");
  }

  const body = {
    content: sanitized.description,
    mediaItems: [{ type: "image", url: imageUrl }],
    platforms: [
      {
        platform: "pinterest",
        accountId: sanitized.accountId,
        platformSpecificData: {
          title: sanitized.title,
          boardId: sanitized.boardId,
          link: sanitized.link
        }
      }
    ],
    publishNow: true
  };

  try {
    const linkUrl = new URL(sanitized.link);
    console.error("[Getlate Pinterest] Payload summary:", {
      imageUrlHost: imageUrl ? new URL(imageUrl).hostname : "(none)",
      link: `${linkUrl.protocol}//${linkUrl.hostname}${linkUrl.pathname}` + (linkUrl.search ? "..." : ""),
      linkIsValid: true,
      linkPresent: !!sanitized.link && sanitized.link.length > 0,
      titleLength: sanitized.title.length,
      descriptionLength: sanitized.description.length,
      boardId: sanitized.boardId,
      boardIdFormat: sanitized.boardId.includes("/") ? "username/board-name" : "numeric-id",
      platformSpecificDataLink: sanitized.link.slice(0, 100)
    });
    console.error("[Getlate Pinterest] Full platformSpecificData being sent:", JSON.stringify(body.platforms[0]?.platformSpecificData, null, 2));
    console.error("[Getlate Pinterest] Full request body (for Getlate bug GET-227):", JSON.stringify(body, null, 2));
  } catch (err) {
    console.error("[Getlate Pinterest] Payload summary (link validation failed):", {
      link: sanitized.link.slice(0, 80),
      linkIsValid: false,
      linkError: err instanceof Error ? err.message : String(err),
      titleLength: sanitized.title.length,
      descriptionLength: sanitized.description.length,
      boardId: sanitized.boardId
    });
    throw new Error(`Pin link is not a valid URL: ${sanitized.link.slice(0, 100)}`);
  }

  const res = await fetch(`${GETLATE_API_BASE}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sanitized.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Getlate create post failed: ${res.status} ${text}`);
  }

  type PlatformEntry = { platform?: string; platformPostUrl?: string };
  let data: { post?: { _id?: string; platforms?: PlatformEntry[] } };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Getlate response not JSON: ${text.slice(0, 200)}`);
  }

  const post = data.post;
  if (!post?._id) {
    throw new Error("Getlate did not return post id");
  }

  const pinterestPlatform = post.platforms?.find(
    (p: PlatformEntry) => String(p.platform ?? "").toLowerCase() === "pinterest"
  );
  const platformUrl = (pinterestPlatform?.platformPostUrl?.trim() && pinterestPlatform.platformPostUrl) || sanitized.link;

  return {
    id: post._id,
    link: platformUrl,
    title: sanitized.title
  };
}

/**
 * List Pinterest boards for a Getlate account.
 * Use the returned board `id` (long numeric) as PINTEREST_BOARD_ID – not the Getlate account ID.
 */
export async function listPinterestBoards(apiKey: string, accountId: string): Promise<{ id: string; name?: string }[]> {
  const res = await fetch(`${GETLATE_API_BASE}/accounts/${encodeURIComponent(accountId)}/pinterest-boards`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Getlate list Pinterest boards failed: ${res.status} ${text}`);
  }
  let data: { boards?: { id: string; name?: string }[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Getlate response not JSON: ${text.slice(0, 200)}`);
  }
  const boards = data.boards ?? [];
  return boards.map((b) => ({ id: b.id, name: b.name }));
}
