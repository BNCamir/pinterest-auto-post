import { z } from "zod";
import { requestJson } from "../http.js";

const trendItemSchema = z.object({
  keyword: z.string().min(1),
  score: z.number().optional(),
  rising: z.boolean().optional()
});

const trendsResponseSchema = z.object({
  items: z.array(trendItemSchema)
});

export type TrendItem = z.infer<typeof trendItemSchema>;

export async function fetchTrendingKeywords(input: {
  url: string;
  token?: string;
  timeoutMs?: number;
}): Promise<TrendItem[]> {
  const headers: Record<string, string> = {};
  if (input.token) {
    headers.Authorization = `Bearer ${input.token}`;
  }
  const data = await requestJson<unknown>(input.url, {
    method: "GET",
    headers,
    timeoutMs: input.timeoutMs
  });
  const parsed = trendsResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Google Trends MCP response did not match expected schema");
  }
  return parsed.data.items;
}
