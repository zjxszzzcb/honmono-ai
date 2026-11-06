import { HumanMessage } from "@langchain/core/messages";
import type { ResolvedModel } from "@honmono/db";

type LangfuseHandler = import("@langfuse/langchain").CallbackHandler;

let handlerCtor: (new (params: Record<string, unknown>) => LangfuseHandler) | null = null;
let otelRegistered = false;

function langfuseEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_BASE_URL);
}

/**
 * 注册全局 OTel TracerProvider，把 @langfuse/tracing 的 span 导出到 Langfuse OTLP 端点。
 * 幂等；在进程启动时调用一次。
 */
export async function setupLangfuseOtel(): Promise<boolean> {
  if (otelRegistered || !langfuseEnabled()) return false;
  try {
    if (process.env.OTEL_DIAG === "1") {
      const { diag, DiagConsoleLogger, DiagLogLevel } = await import("@opentelemetry/api");
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    }
    const [{ NodeTracerProvider, BatchSpanProcessor }, otlpHttp, resourcesMod] = await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
    ]);
    const OTLPTraceExporter = (otlpHttp as unknown as { OTLPTraceExporter: new (o: object) => object }).OTLPTraceExporter;
    // 兼容 resources 1.x（Resource 类）与 2.x（resourceFromAttributes）
    type ResourceLike = { resourceFromAttributes?: (o: Record<string, unknown>) => unknown; Resource?: new (o: Record<string, unknown>) => unknown };
    const rm = resourcesMod as unknown as ResourceLike & { default?: ResourceLike };
    const resourceApi = rm.resourceFromAttributes ? rm : (rm.default ?? rm);
    const resource = resourceApi.resourceFromAttributes
      ? resourceApi.resourceFromAttributes({ "service.name": process.env.OTEL_SERVICE_NAME ?? "honmono-app" })
      : new (resourceApi.Resource as new (o: Record<string, unknown>) => unknown)({ "service.name": process.env.OTEL_SERVICE_NAME ?? "honmono-app" });
    const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
    const exporter = new OTLPTraceExporter({
      url: `${process.env.LANGFUSE_BASE_URL!.replace(/\/+$/, "")}/api/public/otel/v1/traces`,
      headers: { Authorization: `Basic ${auth}` },
    });
    const provider = new NodeTracerProvider({
      resource: resource as never,
      spanProcessors: [new BatchSpanProcessor(exporter as never, { maxQueueSize: 2048, scheduledDelayMillis: 2000 })],
    });
    // 不依赖全局注册（npm 可能存在多份 @opentelemetry/api 实例）：
    // 直接把 provider 注入 @langfuse/tracing 的隔离状态，Langfuse handler 从这里取 tracer
    const tracing = await import("@langfuse/tracing");
    (tracing as unknown as { setLangfuseTracerProvider: (p: unknown) => void }).setLangfuseTracerProvider(provider);
    provider.register();
    otelRegistered = true;
    console.log("[langfuse] OTLP exporter registered ->", process.env.LANGFUSE_BASE_URL);
    return true;
  } catch (err) {
    console.error("[langfuse] OTel setup failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function ensureHandlerCtor() {
  if (!langfuseEnabled()) return null;
  if (!handlerCtor) {
    const mod = await import("@langfuse/langchain");
    handlerCtor = mod.CallbackHandler as unknown as new (params: Record<string, unknown>) => LangfuseHandler;
  }
  return handlerCtor;
}

/** 每个 Run 独立 handler，避免并发串线；返回 null 表示未启用 */
export async function createRunTracer(input: {
  traceName: "chat.request" | "configuration.run" | "test.run";
  traceId: string;
  sessionId: string;
  userId?: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
}): Promise<{ handler: LangfuseHandler; runName: string; flush: () => Promise<void> } | null> {
  const Ctor = await ensureHandlerCtor();
  if (!Ctor) return null;
  const handler = new Ctor({
    sessionId: input.sessionId,
    userId: input.userId ?? undefined,
    tags: input.tags,
    traceMetadata: input.metadata,
  });
  return {
    handler,
    runName: input.traceName,
    flush: async () => {
      try {
        const core = await import("@langfuse/core");
        const anyCore = core as unknown as { langfuse?: { flushAsync?: () => Promise<void> } };
        await anyCore.langfuse?.flushAsync?.();
      } catch {
        // flush 失败不影响主流程（OTel 批量上报会兜底）
      }
    },
  };
}

/** 进程退出前尽力刷新 OTel 批量缓冲 */
export async function shutdownLangfuse(): Promise<void> {
  try {
    const core = await import("@langfuse/core");
    const anyCore = core as unknown as { langfuse?: { shutdownAsync?: () => Promise<void> } };
    await anyCore.langfuse?.shutdownAsync?.();
  } catch {
    // ignore
  }
}

// ============ harness profile：排除危险工具、禁用子代理 ============
const registeredModels = new Set<string>();

export function ensureHarnessProfile(modelKey: string) {
  const key = `anthropic:${modelKey}`;
  if (registeredModels.has(key)) return;
  registeredModels.add(key);
  registerHarnessProfile(key, {
    excludedTools: ["delete", "execute", "task"],
    generalPurposeSubagent: { enabled: false },
  });
}

import { registerHarnessProfile } from "deepagents";

export function isAnthropicProvider(resolved: ResolvedModel): boolean {
  return resolved.providerType === "anthropic";
}

// ============ response 契约 ============
export const RESPONSE_NUDGE =
  "系统提示：你上一条消息是普通文本，客户不会看到。所有面向客户的回复必须通过调用 response 工具发出。请现在调用 response 工具，把刚才的内容作为 text 参数发出。";

export function nudgeMessages(messages: unknown[]): unknown[] {
  return [...messages, new HumanMessage(RESPONSE_NUDGE)];
}
