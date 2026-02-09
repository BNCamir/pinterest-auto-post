/**
 * Create Pinterest pins via Getlate (Late) API.
 * When using Getlate, connect your Pinterest in the Getlate dashboard and use GETLATE_PINTEREST_ACCOUNT_ID.
 */

const GETLATE_API_BASE = "https://getlate.dev/api/v1";

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

export async function createPinViaGetlate(input: CreatePinViaGetlateInput): Promise<GetlatePinResult> {
  let imageUrl = input.imageUrl;
  if (!imageUrl && input.imageBase64) {
    imageUrl = await uploadImageToGetlate(
      input.apiKey,
      input.imageBase64,
      input.imageContentType ?? "image/png"
    );
  }
  if (!imageUrl) {
    throw new Error("createPinViaGetlate requires imageUrl or imageBase64");
  }

  const body = {
    content: input.description,
    mediaItems: [{ url: imageUrl }],
    platforms: [
      {
        platform: "pinterest",
        accountId: input.accountId,
        platformSpecificData: {
          title: input.title,
          boardId: input.boardId,
          link: input.link
        }
      }
    ],
    publishNow: true
  };

  const res = await fetch(`${GETLATE_API_BASE}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
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
  const platformUrl = (pinterestPlatform?.platformPostUrl?.trim() && pinterestPlatform.platformPostUrl) || input.link;

  return {
    id: post._id,
    link: platformUrl,
    title: input.title
  };
}
