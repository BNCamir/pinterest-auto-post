import { requestJson } from "../http.js";

export async function generatePinImage(input: {
  apiUrl: string;
  apiKey: string;
  model: string;
  primaryKeyword: string;
  brandName: string;
  aspectRatio?: "1000:1500" | "1000:1800";
}): Promise<{ imageDataBase64: string; mimeType: string }> {
  const prompt = `Generate a single vertical image (no text in the image). Pinterest-style lifestyle or food photo. Theme: ${input.primaryKeyword}. Professional, appetizing, no fake brands or logos. Natural lighting, clean composition. Output only the image.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"]
    }
  };

  const base = input.apiUrl.replace(/\/$/, "");
  const url = `${base}/models/${input.model}:generateContent?key=${input.apiKey}`;
  type Part = { inlineData?: { data: string; mimeType: string } };
  const response = await requestJson<{
    candidates?: { content?: { parts?: Part[] } }[];
  }>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 60000
  });

  const parts = response.candidates?.[0]?.content?.parts;
  const imagePart = parts?.find((p: Part) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    const blockReason = (response as { candidates?: { finishReason?: string; safetyRatings?: unknown }[] }).candidates?.[0]?.finishReason;
    const partTypes = parts?.map((p: Part) => (p.inlineData ? "inlineData" : "text")) ?? [];
    console.error("Gemini image response:", {
      hasCandidates: !!response.candidates?.length,
      blockReason,
      partTypes,
      rawPartsCount: parts?.length ?? 0
    });
    throw new Error(`Gemini did not return image data${blockReason ? ` (finishReason: ${blockReason})` : ""}`);
  }
  return {
    imageDataBase64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType ?? "image/png"
  };
}
