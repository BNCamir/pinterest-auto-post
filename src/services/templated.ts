export type TemplatedInput = {
    apiKey: string;
    templateId: string;
    imageUrl?: string;
    imageBase64?: string;
    headline: string;
    brandName: string;
};

export type TemplatedResult = {
    renderUrl: string;
    width: number;
    height: number;
};

/**
 * Render an image using Templated.io API.
 * Docs: https://templated.io/docs
 */
export async function createPinFromTemplated(input: TemplatedInput): Promise<TemplatedResult> {
    const url = "https://api.templated.io/v1/render";

    // Map input data to template layers
    // Template: Colorful Photo Collage Breakfast Ideas Food Pinterest Pin (0190937d-0580-4a6a-8cc0-8edf143bb0b3)
    const layers: Record<string, any> = {
        "title-text": { text: input.headline },
        "website-text": { text: input.brandName },
        "number-text": { text: "" } // Hide the number
    };

    const imagePayload = input.imageUrl
        ? { image_url: input.imageUrl }
        : { image_base64: input.imageBase64 }; // Ensure strict base64 (no data:image/png;base64, prefix if API expects raw base64, usually API expects raw or data uri. Let's try raw if field is image_base64)

    // Apply image to all 4 slots
    const imageSlots = ["image-top-left", "image-top-right", "image-bottom-left", "image-bottom-right"];
    for (const slot of imageSlots) {
        layers[slot] = imagePayload;
    }

    const payload = {
        template: input.templateId,
        layers
    };

    const response = await fetch(url, {
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

    const data = (await response.json()) as { render_url?: string; renderUrl?: string };
    const renderUrl = data.render_url ?? data.renderUrl;

    if (!renderUrl) {
        throw new Error("Templated.io did not return a render_url");
    }

    return {
        renderUrl,
        width: 1000,
        height: 1500
    };
}
