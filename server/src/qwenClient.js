import OpenAI from "openai";
import { getRequiredEnv } from "./env.js";

export function createQwenClient() {
  const apiKey = getRequiredEnv("QWEN_API_KEY");
  const baseURL = getRequiredEnv("QWEN_BASE_URL");
  return new OpenAI({ apiKey, baseURL });
}

export function getQwenConfig() {
  const model = getRequiredEnv("QWEN_MODEL");
  const maxTokensRaw = process.env.QWEN_MAX_TOKENS ?? "8192";
  const maxTokens = Number.parseInt(maxTokensRaw, 10);
  return { model, enableThinking: false, maxTokens: Number.isFinite(maxTokens) ? maxTokens : 8192 };
}
