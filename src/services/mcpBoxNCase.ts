import { z } from "zod";
import { requestJson } from "../http.js";

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  keywords: z.array(z.string()).optional()
});

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string().optional(),
  keywords: z.array(z.string()).optional()
});

const contextSchema = z.object({
  categories: z.array(categorySchema).default([]),
  products: z.array(productSchema).default([])
});

export type BoxNCaseContext = z.infer<typeof contextSchema>;

export async function fetchBoxNCaseContext(input: {
  url: string;
  token?: string;
  timeoutMs?: number;
}): Promise<BoxNCaseContext> {
  const headers: Record<string, string> = {};
  if (input.token) {
    headers.Authorization = `Bearer ${input.token}`;
  }
  const data = await requestJson<unknown>(input.url, {
    method: "GET",
    headers,
    timeoutMs: input.timeoutMs ?? 15000
  });
  const parsed = contextSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("BoxNCase MCP response did not match expected schema");
  }
  return parsed.data;
}

export function extractContextKeywords(context: BoxNCaseContext): string[] {
  const keywords = new Set<string>();
  for (const category of context.categories) {
    if (category.name) keywords.add(category.name.toLowerCase());
    for (const keyword of category.keywords ?? []) {
      keywords.add(keyword.toLowerCase());
    }
  }
  for (const product of context.products) {
    if (product.name) keywords.add(product.name.toLowerCase());
    for (const keyword of product.keywords ?? []) {
      keywords.add(keyword.toLowerCase());
    }
  }
  return Array.from(keywords);
}
