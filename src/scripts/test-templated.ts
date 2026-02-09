import "dotenv/config";
import { createPinFromTemplated } from "../services/templated.js";

async function main() {
    const apiKey = process.env.TEMPLATED_API_KEY;
    const templateId = process.env.TEMPLATED_TEMPLATE_ID;

    if (!apiKey || !templateId) {
        console.error("Missing TEMPLATED_API_KEY or TEMPLATED_TEMPLATE_ID");
        return;
    }

    console.log("Testing Templated.io generation...");
    try {
        const result = await createPinFromTemplated({
            apiKey,
            templateId,
            imageUrl: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?q=80&w=1000&auto=format&fit=crop", // Sample image
            headline: "Test Headline From Script",
            brandName: "My Brand"
        });

        console.log("Success!");
        console.log("Render URL:", result.renderUrl);
    } catch (err) {
        console.error("Failed:", err);
    }
}

main();
