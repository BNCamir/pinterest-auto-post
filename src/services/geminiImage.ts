import { requestJson } from "../http.js";
import { getLocalTemplateBase64 } from "./localTemplates.js";

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
 * Add headline and brand logo to a local template image using Gemini.
 * This uses the template as-is and adds text overlays with the actual logo.
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
  
  // Read the local template file
  const { data: templateBase64, mimeType: templateMimeType } = await getLocalTemplateBase64(input.templatePath);
  
  // Read logo if provided
  let logoBase64: string | null = null;
  let logoMimeType: string = "image/png";
  if (input.logoPath) {
    try {
      const logoData = await getLocalTemplateBase64(input.logoPath);
      logoBase64 = logoData.data;
      logoMimeType = logoData.mimeType;
      console.error(`[Local Template] Loaded logo from ${input.logoPath}`);
    } catch (err) {
      console.error(`[Local Template] Failed to load logo: ${(err as Error).message}`);
    }
  }
  
  const prompt = `Add text and branding to this Pinterest pin template image to make it look natural and professionally designed, NOT AI-generated.

CRITICAL - DO NOT ADD: No globe icons, no website links, no URLs, no "www" or .com text anywhere. Only the headline and the logo.

DESIGN REQUIREMENTS:
- Keep the template's overall design and layout exactly as shown
- Add the headline text "${input.headline}" with VARIED, CREATIVE FONTS:
  * Use a mix of font styles (serif, sans-serif, script, display fonts)
  * Vary font sizes and weights for visual interest
  * Use different fonts for different words/phrases if it enhances readability
  * Make it look like a real designer created it, not AI
  * Position text where it naturally fits in the template (match template's text placement)
- ${logoBase64 ? `Add the provided LOGO IMAGE (not text) in the bottom corner as a watermark/brand mark. Size it appropriately - visible but not overpowering.` : input.brandName ? `Add "${input.brandName}" as subtle text branding in the corner` : ""}
- Make the design look NATURAL and HAND-CRAFTED:
  * Avoid overly perfect alignment - slight variations are more natural
  * Use realistic text shadows, outlines, or effects that match the template style
  * Ensure text integrates seamlessly with the template (not floating or disconnected)
  * Match the template's color scheme and aesthetic
- Do NOT add overlapping or duplicate text
- Do NOT add any globe icons, website links, URLs, or "www" text anywhere in the image - no link graphics, no URL text
- Keep the vertical Pinterest format
- The final result should look like a real Pinterest pin created by a professional designer, not an AI-generated image

Make it look authentic and well-designed, matching the quality of top Pinterest pins. Only the headline and logo/brand - no links or globe icons.`;

  // Build request parts array with template and optionally logo
  const requestParts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [
    { text: "Pinterest pin template to add text to:" },
    { inlineData: { data: templateBase64, mimeType: templateMimeType } }
  ];
  
  if (logoBase64) {
    requestParts.push(
      { text: "Brand logo to add as watermark:" },
      { inlineData: { data: logoBase64, mimeType: logoMimeType } }
    );
  }
  
  requestParts.push({ text: prompt });

  const body = {
    contents: [
      {
        parts: requestParts
      }
    ],
    generationConfig: {
      responseModalities: ["IMAGE"]
    }
  };

  const base = input.apiUrl.replace(/\/$/, "");
  const url = `${base}/models/${input.model}:generateContent?key=${input.apiKey}`;
  console.error(`[Local Template] Sending template to Gemini to add headline and brand...`);
  
  type Part = { inlineData?: { data: string; mimeType: string }; text?: string };
  const response = await requestJson<{
    candidates?: { content?: { parts?: Part[] } }[];
  }>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 90000
  });

  console.error(`[Local Template] Received response from Gemini`);
  const parts = response.candidates?.[0]?.content?.parts;
  const imagePart = parts?.find((p: Part) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    const blockReason = (response as { candidates?: { finishReason?: string; safetyRatings?: unknown }[] }).candidates?.[0]?.finishReason;
    const textParts = parts?.filter((p: Part) => p.text).map((p: Part) => p.text) ?? [];
    console.error("[Local Template] ERROR - No image in response:", {
      blockReason,
      textParts
    });
    throw new Error(`Gemini failed to add text to template${blockReason ? ` (finishReason: ${blockReason})` : ""}`);
  }
  
  console.error(`[Local Template] SUCCESS - Template with text added`);
  return {
    imageDataBase64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType ?? "image/png"
  };
}
