import { requestJson } from "../http.js";

export type CreatePinInput = {
  baseUrl: string;
  accessToken: string;
  boardId: string;
  title: string;
  description: string;
  link: string;
  /** Use when you have a public image URL (e.g. from Canva export). */
  imageUrl?: string;
  /** Use when you have raw image data (e.g. from Gemini). Pinterest uses source_type "image_base64". */
  imageBase64?: string;
  /** Mime type for imageBase64; default "image/png". */
  imageContentType?: string;
};

export type PinterestPinResult = {
  id: string;
  link: string;
  title: string;
};

export async function createPin(input: CreatePinInput): Promise<PinterestPinResult> {
  if (!input.imageUrl && !input.imageBase64) {
    throw new Error("createPin requires either imageUrl or imageBase64");
  }
  const url = `${input.baseUrl.replace(/\/$/, "")}/pins`;
  const media_source = input.imageBase64
    ? {
        source_type: "image_base64" as const,
        content_type: input.imageContentType ?? "image/png",
        data: input.imageBase64
      }
    : {
        source_type: "image_url" as const,
        url: input.imageUrl!
      };
  const body = {
    board_id: input.boardId,
    title: input.title,
    description: input.description,
    link: input.link,
    media_source
  };

  const response = await requestJson<{ id: string; link?: string; title?: string }>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`
    },
    body: JSON.stringify(body),
    timeoutMs: 30000
  });

  if (!response.id) throw new Error("Pinterest did not return pin id");
  return {
    id: response.id,
    link: response.link ?? input.link,
    title: response.title ?? input.title
  };
}
