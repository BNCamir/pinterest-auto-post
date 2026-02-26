import { readFile } from "fs/promises";
import { requestJson } from "../http.js";
import { getLocalTemplateBase64 } from "./localTemplates.js";
import sharp from "sharp";

/** Remove consecutive duplicate words so the headline is never repeated (e.g. "the the" -> "the"). */
export function sanitizeHeadline(headline: string): string {
  const words = headline.trim().split(/\s+/);
  const out: string[] = [];
  let prev = "";
  for (const w of words) {
    if (w.toLowerCase() !== prev.toLowerCase()) {
      out.push(w);
      prev = w;
    }
  }
  return out.join(" ").trim() || headline.trim();
}

/**
 * Composite the logo image onto the bottom-right of the pin image.
 * Keeps the logo pixel-perfect (no AI redrawing).
 */
async function compositeLogoOntoImage(
  imageBuffer: Buffer,
  imageMime: string,
  logoPath: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const logoBuffer = await readFile(logoPath);
  const img = sharp(imageBuffer);
  const meta = await img.metadata();
  const width = meta.width ?? 1000;
  const height = meta.height ?? 1500;
  const padding = Math.round(Math.min(width, height) * 0.03);
  const logoMaxHeight = Math.round(height * 0.12);
  const logoMaxWidth = Math.round(width * 0.25);
  const resizedLogo = await sharp(logoBuffer)
    .resize(logoMaxWidth, logoMaxHeight, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const logoMeta = await sharp(resizedLogo).metadata();
  const lw = logoMeta.width ?? 0;
  const lh = logoMeta.height ?? 0;
  const left = width - lw - padding;
  const top = height - lh - padding;
  const out = await img
    .composite([{ input: resizedLogo, left, top }])
    .png()
    .toBuffer();
  return { buffer: out, mimeType: "image/png" };
}

export async function generatePinImage(input: {
  apiUrl: string;
  apiKey: string;
  model: string;
  primaryKeyword: string;
  brandName: string;
  aspectRatio?: "1000:1500" | "1000:1800";
}): Promise<{ imageDataBase64: string; mimeType: string }> {
  const prompt = `Generate a single vertical Pinterest pin image (no text in the image). 

REQUIREMENTS:
- MUST be a food or drink photo (appetizing, professional, high-quality)
- Pinterest-style lifestyle food photography
- Vertical format (suitable for Pinterest pins)
- Professional, appetizing presentation
- No fake brands or logos
- Natural lighting, clean composition
- Food should be the main focus (e.g., delicious meals, beverages, snacks, ingredients, cooking scenes)

The image should always be food/drink themed - focus on creating an appealing food or beverage image that would work well as a Pinterest pin background. Output only the image.`;

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

/**
 * Improve/fix an existing image using Gemini.
 * Downloads the image from URL, sends it to Gemini with a prompt to fix issues,
 * and returns the improved image.
 * 
 * Strategy: Instead of trying to "fix" the broken Templated image, we'll ask Gemini
 * to recreate a clean Pinterest pin from scratch using the original food image + headline.
 */
export async function improveImageWithGemini(input: {
  apiUrl: string;
  apiKey: string;
  model: string;
  imageUrl: string;
  improvementPrompt?: string;
  /** Original food image URL (if available) - use this to recreate instead of fixing broken template */
  originalFoodImageUrl?: string;
  /** Headline text to include in the pin */
  headline?: string;
  /** Brand name to include */
  brandName?: string;
}): Promise<{ imageDataBase64: string; mimeType: string }> {
  // Strategy: If we have the original food image, recreate from scratch using template as inspiration
  if (input.originalFoodImageUrl && input.headline) {
    console.error(`[Gemini Improvement] RECREATING pin using template as inspiration + original food image + headline`);
    
    // Download original food image
    const originalRes = await fetch(input.originalFoodImageUrl, { method: "GET" });
    if (!originalRes.ok) {
      throw new Error(`Failed to fetch original food image: ${originalRes.status}`);
    }
    const originalContentType = originalRes.headers.get("content-type") ?? "image/png";
    const originalBuffer = await originalRes.arrayBuffer();
    const originalBase64 = Buffer.from(originalBuffer).toString("base64");
    
    // Download the Templated template image to use as design inspiration
    console.error(`[Gemini Improvement] Downloading template image for design inspiration...`);
    const templateRes = await fetch(input.imageUrl, { method: "GET" });
    if (!templateRes.ok) {
      throw new Error(`Failed to fetch template image for inspiration: ${templateRes.status}`);
    }
    const templateContentType = templateRes.headers.get("content-type") ?? "image/png";
    const templateBuffer = await templateRes.arrayBuffer();
    const templateBase64 = Buffer.from(templateBuffer).toString("base64");
    
    const recreatePrompt = input.improvementPrompt ?? `Create a clean, professional Pinterest pin image inspired by the template design shown, but using the food photo as the main background.

DESIGN INSPIRATION (from template):
- Study the template's layout, color scheme, text placement, and overall style
- Recreate a similar design aesthetic but with clean, professional execution
- Match the template's visual style (fonts, colors, composition) but fix all the problems

REQUIREMENTS:
- Use the provided FOOD IMAGE as the main background/hero image (replace any broken elements in the template)
- Add the headline text "${input.headline}" in a style similar to the template but clean and readable
- ${input.brandName ? `Add "${input.brandName}" as a subtle brand name/watermark` : ""}
- Vertical Pinterest format (1000x1500 or similar)
- Match the template's design language but fix:
  * Remove ALL overlapping or duplicated text
  * Remove any white blocks, overlays, or fragmented elements
  * Keep only ONE instance of each text element
  * Ensure clean, professional execution
  * Make the food image prominent and appetizing

The final result should look like a professionally executed version of the template design, with the food image properly integrated and all text clean and readable.`;

    const body = {
      contents: [
        {
          parts: [
            { text: "Template design to use as inspiration (fix all overlapping text and broken elements):" },
            { inlineData: { data: templateBase64, mimeType: templateContentType } },
            { text: "Food image to use as the main background:" },
            { inlineData: { data: originalBase64, mimeType: originalContentType } },
            { text: recreatePrompt }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["IMAGE"]
      }
    };

    const base = input.apiUrl.replace(/\/$/, "");
    const url = `${base}/models/${input.model}:generateContent?key=${input.apiKey}`;
    console.error(`[Gemini Improvement] Calling Gemini to RECREATE pin from scratch...`);
    
    type Part = { inlineData?: { data: string; mimeType: string }; text?: string };
    const response = await requestJson<{
      candidates?: { content?: { parts?: Part[] } }[];
    }>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 90000
    });

    console.error(`[Gemini Improvement] Received recreation response from Gemini`);
    const parts = response.candidates?.[0]?.content?.parts;
    const imagePart = parts?.find((p: Part) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      const blockReason = (response as { candidates?: { finishReason?: string; safetyRatings?: unknown }[] }).candidates?.[0]?.finishReason;
      const textParts = parts?.filter((p: Part) => p.text).map((p: Part) => p.text) ?? [];
      console.error("[Gemini Improvement] ERROR - No image in recreation response:", {
        blockReason,
        textParts
      });
      throw new Error(`Gemini recreation failed${blockReason ? ` (finishReason: ${blockReason})` : ""}`);
    }
    
    console.error(`[Gemini Improvement] SUCCESS - Recreated pin image`);
    return {
      imageDataBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? "image/png"
    };
  }

  // Fallback: Try to fix the broken Templated image (less effective)
  console.error(`[Gemini Improvement] Attempting to fix broken Templated image (less effective than recreation)...`);
  
  // Download the broken Templated image
  const imageRes = await fetch(input.imageUrl, { method: "GET" });
  if (!imageRes.ok) {
    throw new Error(`Failed to fetch image for improvement: ${imageRes.status} ${input.imageUrl.slice(0, 60)}...`);
  }
  const imageContentType = imageRes.headers.get("content-type") ?? "image/png";
  const imageBuffer = await imageRes.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer).toString("base64");
  console.error(`[Gemini Improvement] Downloaded broken image (${imageBuffer.byteLength} bytes, ${imageContentType}), attempting fix...`);

  // Aggressive prompt to fix broken template
  const prompt = input.improvementPrompt ?? `This Pinterest pin image is severely broken and needs complete reconstruction:

CRITICAL FIXES REQUIRED:
1. REMOVE ALL overlapping, duplicated, or repeated text - keep only ONE instance of each word/phrase
2. REMOVE any faded, blurry, semi-transparent, or white overlay blocks that create clutter
3. Keep ONLY the main headline text in a single, clear, readable font - delete all duplicates
4. Clean up the background - remove white blocks, fragmented elements, or unrelated themes (like winter scenes if this is about food/drink)
5. Ensure the main food/drink image is prominently displayed and well-integrated
6. Create a clean, professional Pinterest pin with:
   - ONE clear headline (no duplicates)
   - Proper spacing and visual hierarchy
   - No text overlap
   - Cohesive design that matches the food/drink theme

The final image must look like a professionally designed Pinterest pin, not a broken template with overlapping text.`;

  const body = {
    contents: [
      {
        parts: [
          { inlineData: { data: imageBase64, mimeType: imageContentType } },
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["IMAGE"]
    }
  };

  const base = input.apiUrl.replace(/\/$/, "");
  const url = `${base}/models/${input.model}:generateContent?key=${input.apiKey}`;
  console.error(`[Gemini Improvement] Calling Gemini API: ${url} with model ${input.model}`);
  
  type Part = { inlineData?: { data: string; mimeType: string }; text?: string };
  const response = await requestJson<{
    candidates?: { content?: { parts?: Part[] } }[];
  }>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 90000 // Longer timeout for image editing
  });

  console.error(`[Gemini Improvement] Received response from Gemini`);
  const parts = response.candidates?.[0]?.content?.parts;
  const imagePart = parts?.find((p: Part) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    const blockReason = (response as { candidates?: { finishReason?: string; safetyRatings?: unknown }[] }).candidates?.[0]?.finishReason;
    const textParts = parts?.filter((p: Part) => p.text).map((p: Part) => p.text) ?? [];
    const partTypes = parts?.map((p: Part) => (p.inlineData ? "inlineData" : p.text ? "text" : "unknown")) ?? [];
    console.error("[Gemini Improvement] ERROR - No image in response:", {
      hasCandidates: !!response.candidates?.length,
      blockReason,
      partTypes,
      textParts,
      rawPartsCount: parts?.length ?? 0,
      fullResponse: JSON.stringify(response, null, 2).slice(0, 500)
    });
    throw new Error(`Gemini did not return improved image data${blockReason ? ` (finishReason: ${blockReason})` : ""}${textParts.length > 0 ? `. Text response: ${textParts.join(" ")}` : ""}`);
  }
  
  console.error(`[Gemini Improvement] SUCCESS - Received improved image (${imagePart.inlineData.data.length} chars base64)`);
  return {
    imageDataBase64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType ?? "image/png"
  };
}

/**
 * Add headline (and optionally brand logo) to a local template image.
 * - Headline: added by Gemini with exact text (sanitized, no duplicate words).
 * - Logo: when logoPath is set, we composite the real logo image in code so it is never redrawn by AI (avoids misspellings like "Casse").
 */
export async function addTextToLocalTemplate(input: {
  apiUrl: string;
  apiKey: string;
  model: string;
  templatePath: string;
  headline: string;
  brandName?: string;
  logoPath?: string;
}): Promise<{ imageDataBase64: string; mimeType: string }> {
  console.error(`[Local Template] Loading template from ${input.templatePath}...`);
  const headline = sanitizeHeadline(input.headline);
  if (headline !== input.headline) {
    console.error(`[Local Template] Sanitized headline (removed duplicate words): "${input.headline}" -> "${headline}"`);
  }

  const { data: templateBase64, mimeType: templateMimeType } = await getLocalTemplateBase64(input.templatePath);
  const useLogoComposite = !!input.logoPath;

  const prompt = `Add ONLY the headline text to this Pinterest pin template. Make it look natural and professionally designed, NOT AI-generated.

CRITICAL RULES:
- Do NOT add any brand name, logo, watermark, or website/URL/globe icons. Only the headline.
- Use this EXACT headline text with no repeated words and no changes: "${headline}"
- Keep the template's design and layout. Place the headline where text naturally fits (match template's text placement).
- Use varied, creative fonts (mix of serif, sans-serif, script) so it looks hand-crafted, not AI. One instance of each word only.
- No overlapping or duplicate text. No links, no .com, no www.
- Vertical Pinterest format. Result must look like a professional designer made it.`;

  const requestParts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [
    { text: "Pinterest pin template to add text to:" },
    { inlineData: { data: templateBase64, mimeType: templateMimeType } },
    { text: prompt }
  ];

  const body = {
    contents: [{ parts: requestParts }],
    generationConfig: { responseModalities: ["IMAGE"] }
  };

  const base = input.apiUrl.replace(/\/$/, "");
  const url = `${base}/models/${input.model}:generateContent?key=${input.apiKey}`;
  console.error(`[Local Template] Sending template to Gemini (headline only; logo will be composited separately).`);
  type Part = { inlineData?: { data: string; mimeType: string }; text?: string };
  const response = await requestJson<{
    candidates?: { content?: { parts?: Part[] } }[];
  }>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 90000
  });

  const parts = response.candidates?.[0]?.content?.parts;
  const imagePart = parts?.find((p: Part) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    const blockReason = (response as { candidates?: { finishReason?: string }[] }).candidates?.[0]?.finishReason;
    throw new Error(`Gemini failed to add text to template${blockReason ? ` (finishReason: ${blockReason})` : ""}`);
  }

  let imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
  let mimeType = imagePart.inlineData.mimeType ?? "image/png";

  if (useLogoComposite) {
    console.error(`[Local Template] Compositing logo from ${input.logoPath} (pixel-perfect, no AI redraw).`);
    const composited = await compositeLogoOntoImage(imageBuffer, mimeType, input.logoPath!);
    imageBuffer = Buffer.from(composited.buffer);
    mimeType = composited.mimeType;
  }

  console.error(`[Local Template] SUCCESS - Template with headline${useLogoComposite ? " and logo" : ""} ready.`);
  return {
    imageDataBase64: imageBuffer.toString("base64"),
    mimeType
  };
}
