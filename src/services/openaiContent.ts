import { requestJson } from "../http.js";

export type BlogContent = {
  title: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
  internalLinkingNotes: string;
};

export type PinterestCopy = {
  headline: string;
  description: string;
};

export type GeneratedContent = {
  blog: BlogContent;
  pinterest: PinterestCopy;
};

export async function generateContent(input: {
  apiUrl: string;
  apiKey: string;
  model: string;
  primaryKeyword: string;
  supportingKeywords: string[];
  brandName: string;
  contextSummary?: string;
}): Promise<GeneratedContent> {
  const systemPrompt = `You are a world-class SEO content strategist and food industry expert for ${input.brandName}, a premium B2B food and wholesale supplier. 
  Your goal is to write authoritative, comprehensive, and engaging content that ranks on Google and drives Pinterest traffic.
  Tone: Professional, knowledgeable, yet accessible and inspiring.
  Avoid: Generic fluff, repetitive phrasing, and salesy jargon. Focus on value, utility, and actionable insights.`;

  const userPrompt = `Primary Keyword: "${input.primaryKeyword}"
Supporting Keywords: ${input.supportingKeywords.join(", ")}
${input.contextSummary ? `Context/Trends: ${input.contextSummary}` : ""}

Task: Generate a high-quality blog article and Pinterest creative copy.

Return a SINGLE JSON object with this exact structure:
{
  "blog": {
    "title": "A captivating, SEO-optimized H1 headline (max 60 chars)",
    "bodyHtml": "The full article content in semantic HTML. Guidelines:\n- **Length**: Long-form/In-depth (approx. 1000+ words).\n- **Structure**: Use multiple <h2> and <h3> subheadings to break up text.\n- **Content**: Include an engaging introduction, deep-dive sections, practical tips/recipes/uses, and a conclusion.\n- **SEO**: Naturally weave in the primary and supporting keywords. Use LSI keywords.\n- **Formatting**: Use bullet points (<ul>/<li>) for readability where appropriate.\n- **Internal Links**: Insert 2-3 placeholders like [LINK: suggested anchor text] where relevant to other food categories.",
    "metaTitle": "SEO meta title (max 60 chars) - compelling for clicks",
    "metaDescription": "SEO meta description (150-160 chars) - summarizing the value prop",
    "internalLinkingNotes": "Brief suggestions on what potential internal pages to link to based on the topic."
  },
  "pinterest": {
    "headline": "A viral, click-worthy Pin title (max 100 chars). Focus on the benefit or 'How-To'.",
    "description": "An engaging, keyword-rich Pin description (100-500 chars). Include a call-to-action. NO hashtags. Write naturally."
  }
}`;

  const body = {
    model: input.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" }
  };

  const response = await requestJson<{ choices: { message: { content: string } }[] }>(
    `${input.apiUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify(body),
      timeoutMs: 60000
    }
  );

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned no content");

  const parsed = JSON.parse(raw) as GeneratedContent;
  if (!parsed.blog || !parsed.pinterest) {
    throw new Error("OpenAI response missing blog or pinterest object");
  }
  return parsed;
}
