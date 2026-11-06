import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { ResolvedModel } from "@honmono/db";

/**
 * 模型工厂：由平台 Provider/Model 配置构造可替换的 ChatModel 实例。
 * anthropic 类型：base_url 规范化为 SDK 期望的 origin（SDK 追加 /v1/messages）。
 * openai_compatible：base_url 规范化为 .../v1（SDK 追加 /chat/completions）。
 */
export function createChatModel(resolved: ResolvedModel): BaseLanguageModel {
  const capabilities = resolved.capabilities;
  if (resolved.providerType === "anthropic") {
    return new ChatAnthropic({
      model: resolved.modelKey,
      apiKey: resolved.apiKey,
      anthropicApiUrl: normalizeAnthropicBase(resolved.baseUrl),
      temperature: 0.6,
      maxTokens: 2048,
      clientOptions: {
        timeout: 120_000,
        maxRetries: 2,
        defaultHeaders: resolved.configVersion ? { "x-honmono-config-version": String(resolved.configVersion) } : undefined,
      },
      // Anthropic prompt caching 中间件由 deepagents 依 isAnthropicModel 判定，
      // 指向第三方网关时缓存头不兼容则由网关忽略，不影响功能
    });
  }
  if (resolved.providerType === "openai_compatible") {
    return new ChatOpenAI({
      model: resolved.modelKey,
      apiKey: resolved.apiKey,
      configuration: { baseURL: normalizeOpenAIBase(resolved.baseUrl), timeout: 120_000, maxRetries: 2 },
      temperature: 0.6,
      maxTokens: 2048,
    });
  }
  throw new Error(`不支持的 Provider 类型: ${resolved.providerType}（capabilities: ${JSON.stringify(capabilities)}）`);
}

function stripTrailingSlash(u: string) {
  return u.replace(/\/+$/, "");
}

/** http://host:4000/v1 -> http://host:4000 ；裸 host 保持不变 */
export function normalizeAnthropicBase(baseUrl: string): string {
  const u = stripTrailingSlash(baseUrl);
  return u.endsWith("/v1") ? u.slice(0, -3) : u;
}

/** http://host:4000 -> http://host:4000/v1 ；已带 /v1 保持 */
export function normalizeOpenAIBase(baseUrl: string): string {
  const u = stripTrailingSlash(baseUrl);
  return u.endsWith("/v1") ? u : `${u}/v1`;
}
