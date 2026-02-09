import "dotenv/config";
import { generateContent } from "../services/openaiContent.js";

async function main() {
    console.log("Testing Content Generation with GPT-4o...");

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;

    if (!apiKey) {
        console.error("Missing OPENAI_API_KEY");
        return;
    }

    console.log(`Using model: ${model}`);

    try {
        const result = await generateContent({
            apiUrl: process.env.OPENAI_API_URL || "https://api.openai.com/v1",
            apiKey,
            model: model || "gpt-4o",
            primaryKeyword: "bulk freeze dried candy",
            supportingKeywords: ["wholesale sweets", "freeze dried treats", "bulk candy supplier"],
            brandName: "BoxNCase",
            contextSummary: "Rising popularity of freeze dried candy on TikTok"
        });

        console.log("\n--- BLOG METADATA ---");
        console.log("Title:", result.blog.title);
        console.log("Meta Title:", result.blog.metaTitle);
        console.log("Meta Desc:", result.blog.metaDescription);

        console.log("\n--- BLOG BODY SNAPSHOT (First 500 chars) ---");
        console.log(result.blog.bodyHtml.substring(0, 500));
        console.log("...");

        console.log("\n--- PINTEREST ---");
        console.log("Headline:", result.pinterest.headline);
        console.log("Description:", result.pinterest.description);

    } catch (err) {
        console.error("Failed:", err);
    }
}

main();
