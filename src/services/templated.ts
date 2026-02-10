const TEMPLATED_API_BASE = "https://api.templated.io/v1";

export type TemplatedInput = {
    apiKey: string;
    templateId: string;
    /** Public image URL (required by Templated – use Getlate upload URL). Prefer over imageBase64. */
    imageUrl?: string;
    imageBase64?: string;
    headline: string;
    brandName: string;
    /** For multi-page templates: 0-based page index to render (e.g. 0–9 for 10 pages). Renders only this page. */
    pageIndex?: number;
};

export type TemplatedResult = {
    renderUrl: string;
    width: number;
    height: number;
};

type TemplateLayer = { layer: string; type: string; description?: string };

/**
 * Fetch layer names and types for a template so we can build the render payload correctly.
 * https://templated.io/docs/templates/layers
 */
export async function getTemplateLayers(apiKey: string, templateId: string): Promise<TemplateLayer[]> {
    const url = `${TEMPLATED_API_BASE}/template/${encodeURIComponent(templateId)}/layers`;
    const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Templated.io layers failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as TemplateLayer[];
    return Array.isArray(data) ? data : [];
}

/**
 * Build layers payload for /v1/render by mapping our content to the template's actual layer names.
 * Text layers: first = headline, second = brandName. Image layers: image_url (API does not support base64).
 */
function buildLayersFromTemplate(
    templateLayers: TemplateLayer[],
    headline: string,
    brandName: string,
    imageUrl: string | null
): Record<string, { text?: string; image_url?: string }> {
    const layers: Record<string, { text?: string; image_url?: string }> = {};
    let textIndex = 0;
    const textValues = [headline, brandName];
    for (const { layer, type } of templateLayers) {
        if (type === "text") {
            layers[layer] = { text: textValues[textIndex] ?? headline };
            textIndex++;
        } else if (type === "image" && imageUrl) {
            layers[layer] = { image_url: imageUrl };
        }
    }
    return layers;
}

/**
 * Render an image using Templated.io API.
 * Fetches the template's layers first so any of your templates (e.g. 10 post types) work.
 * Docs: https://templated.io/docs/renders/create/
 */
export async function createPinFromTemplated(input: TemplatedInput): Promise<TemplatedResult> {
    if (!input.imageUrl && !input.imageBase64) {
        throw new Error("Templated.io requires imageUrl (recommended) or imageBase64");
    }
    // Templated API documents image_url; using a URL avoids 500 from unsupported/invalid base64.
    const imageUrl = input.imageUrl ?? null;
    if (!imageUrl && input.imageBase64) {
        throw new Error(
            "Templated.io expects image_url. Upload the image first (e.g. to Getlate) and pass the public URL in imageUrl."
        );
    }

    const templateLayers = await getTemplateLayers(input.apiKey, input.templateId);
    const layers = buildLayersFromTemplate(
        templateLayers,
        input.headline,
        input.brandName,
        imageUrl
    );

    if (Object.keys(layers).length === 0) {
        throw new Error(`Template ${input.templateId} has no text/image layers or layers API returned empty`);
    }

    const pageIndex = input.pageIndex;
    const payload: { template: string; layers?: Record<string, unknown>; pages?: Array<{ page: string; layers: Record<string, unknown> }> } = {
        template: input.templateId
    };

    if (pageIndex !== undefined && pageIndex >= 0) {
        const pageId = `page-${pageIndex + 1}`;
        payload.pages = [{ page: pageId, layers }];
        console.error(`[Templated.io] Rendering page "${pageId}" (pageIndex ${pageIndex}) with ${Object.keys(layers).length} layers`);
    } else {
        payload.layers = layers;
        console.error(`[Templated.io] Rendering default page/all pages (no pageIndex specified) with ${Object.keys(layers).length} layers`);
    }

    const response = await fetch(`${TEMPLATED_API_BASE}/render`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Templated.io render failed: ${response.status} ${text}`);
    }

    const raw = (await response.json()) as
        | { url?: string; render_url?: string; renderUrl?: string; width?: number; height?: number }
        | Array<{ url?: string; render_url?: string; renderUrl?: string; width?: number; height?: number }>;
    const data = Array.isArray(raw) ? raw[0] : raw;
    if (!data) {
        throw new Error("Templated.io did not return render data");
    }
    const renderUrl = data.url ?? data.render_url ?? (data as { renderUrl?: string }).renderUrl;

    if (!renderUrl) {
        throw new Error("Templated.io did not return a render URL");
    }

    return {
        renderUrl,
        width: data.width ?? 1000,
        height: data.height ?? 1500
    };
}
