import { and, asc } from "drizzle-orm";
import { Redis } from "ioredis";
import {
  appendMessage,
  conversations,
  customerServices,
  db,
  decryptSecret,
  getRunById,
  getSkillVersion,
  getSetting,
  listMessages,
  resolveModel,
  searchProviders,
  transitionRun,
  ModelNotConfiguredError,
  type ResolvedModel,
} from "@honmono/db";
import { eq } from "drizzle-orm";
import * as storage from "@honmono/storage";
import {
  createChatModel,
  createRunTracer,
  runRuntimeAgent,
  SearchRouter,
  createWebTools,
  type ChatTurn,
  type ResponseOutcome,
} from "@honmono/agent";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

/** 会话级互斥锁：同一会话同时只有一个 Run 在执行 */
export async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T | "lock_timeout"> {
  const key = `lock:conv:${conversationId}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const got = await redis.set(key, "1", "EX", 150, "NX");
    if (got === "OK") {
      try {
        return await fn();
      } finally {
        await redis.del(key).catch(() => {});
      }
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return "lock_timeout";
}

export async function loadChatTurns(conversationId: string, limit = 40): Promise<ChatTurn[]> {
  const { messages } = await import("@honmono/db");
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.id))
    .limit(200);
  const tail = msgs.slice(-limit);
  return tail
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

export type ChatRunOutcome =
  | { type: "completed"; content: string; skillVersion: number | null }
  | { type: "waiting_input"; text: string; sleepSeconds: number; skillVersion: number | null }
  | { type: "waiting_human"; handoffId: string }
  | { type: "ignored"; reason: string };

/**
 * 执行一个生产/测试 Run 的 Agent 部分（不含队列调度）。
 * 返回语义化结果，由调用方决定持久化细节。
 */
export async function executeChatAgent(input: {
  runId: string;
  withEndUserHash?: string | null;
  traceName?: "chat.request" | "test.run";
}): Promise<ChatRunOutcome> {
  const run = await getRunById(input.runId);
  if (!run) return { type: "ignored", reason: "run_not_found" };
  if (run.state !== "queued") return { type: "ignored", reason: `run_state_${run.state}` };

  const service = (await db.select().from(customerServices).where(eq(customerServices.id, run.serviceId)).limit(1))[0];
  if (!service || service.status !== "ready" || !service.activeSkillVersionId) {
    await transitionRun(run.id, "queued", { state: "failed", errorCode: "service_not_ready", finishedAt: new Date() });
    return { type: "ignored", reason: "service_not_ready" };
  }

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, run.conversationId)).limit(1);
  if (!conv) return { type: "ignored", reason: "conversation_not_found" };
  if (conv.controlState !== "ai") {
    await transitionRun(run.id, "queued", {
      state: "superseded",
      finishedAt: new Date(),
      resultJson: { reason: `control_state_${conv.controlState}` },
    });
    return { type: "ignored", reason: `control_state_${conv.controlState}` };
  }

  const moved = await transitionRun(run.id, "queued", { state: "running", startedAt: new Date() });
  if (!moved) return { type: "ignored", reason: "run_taken" };

  const version = await getSkillVersion(service.activeSkillVersionId);
  if (!version) {
    await transitionRun(run.id, "running", { state: "failed", errorCode: "skill_version_missing", finishedAt: new Date() });
    return { type: "ignored", reason: "skill_version_missing" };
  }

  let resolved: ResolvedModel;
  try {
    resolved = await resolveModel("runtime", service.id);
  } catch (err) {
    const code = err instanceof ModelNotConfiguredError ? "model_not_configured" : "model_resolve_failed";
    await transitionRun(run.id, "running", {
      state: "failed",
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
      finishedAt: new Date(),
    });
    return { type: "ignored", reason: code };
  }

  const tracer = await createRunTracer({
    traceName: input.traceName ?? "chat.request",
    traceId: run.id,
    sessionId: `${service.id}:${conv.externalId ?? conv.channel}`,
    userId: input.withEndUserHash ?? null,
    tags: ["production"],
    metadata: {
      service_id: service.id,
      merchant_id: service.merchantId,
      skill_version: version.version,
      model: resolved.modelKey,
      provider_config_version: resolved.configVersion,
    },
  });

  const timeoutSeconds = await getSetting("chat_run_timeout_seconds", 180);
  const startedAt = Date.now();
  let outcome: ResponseOutcome;
  try {
    const extraTools = await buildWebToolsIfConfigured();
    outcome = await withTimeout(
      runRuntimeAgent({
        model: createChatModel(resolved),
        modelKey: resolved.modelKey,
        skillRootDir: storage.resolveWithin(version.rootPath),
        skillMarkdown: await storage.readText(`${version.rootPath}/SKILL.md`),
        chatMessages: await loadChatTurns(conv.id),
        extraTools,
        callbacks: (tracer ? [tracer.handler] : []) as unknown as undefined,
      }),
      timeoutSeconds * 1000,
      "agent_timeout",
    );
  } catch (err) {
    const code = err instanceof Error && err.message === "agent_timeout" ? "agent_timeout" : err instanceof ModelNotConfiguredError ? "model_not_configured" : "agent_failed";
    await transitionRun(run.id, "running", {
      state: "failed",
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
      finishedAt: new Date(),
    });
    await tracer?.flush();
    return { type: "ignored", reason: code };
  }

  await transitionRun(run.id, "running", {
    modelKey: resolved.modelKey,
    providerConfigVersion: resolved.configVersion,
    capabilitiesSnapshot: resolved.capabilities as object,
    skillVersionId: version.id,
  });

  if (outcome.kind === "response") {
    if (outcome.sleepSeconds >= 2) {
      const deadline = new Date(Date.now() + outcome.sleepSeconds * 1000);
      await transitionRun(run.id, "running", {
        state: "waiting_input",
        pendingText: outcome.text,
        deadlineAt: deadline,
      });
      await tracer?.flush();
      return { type: "waiting_input", text: outcome.text, sleepSeconds: outcome.sleepSeconds, skillVersion: version.version };
    }
    await appendMessage({
      conversationId: conv.id,
      serviceId: service.id,
      role: "assistant",
      authorType: "ai",
      content: outcome.text,
      runId: run.id,
    });
    if (outcome.degraded) {
      console.warn(`[worker] run ${run.id} response contract degraded (fallback text used)`);
    }
    await transitionRun(run.id, "running", {
      state: "succeeded",
      finishedAt: new Date(),
      traceId: run.id,
      errorCode: outcome.degraded ? "response_contract_degraded" : null,
      resultJson: { content: outcome.text, skill_version: version.version, degraded: outcome.degraded ?? false },
    });
    await tracer?.flush();
    return { type: "completed", content: outcome.text, skillVersion: version.version };
  }

  // ask_human
  const { handoffs } = await import("@honmono/db");
  const [h] = await db
    .insert(handoffs)
    .values({
      serviceId: service.id,
      conversationId: conv.id,
      runId: run.id,
      reason: outcome.reason,
      question: outcome.question,
      contextSummary: outcome.contextSummary,
      suggestedReplies: outcome.suggestedReplies,
    })
    .returning();
  await db.update(conversations).set({ controlState: "pending_human" }).where(eq(conversations.id, conv.id));
  await transitionRun(run.id, "running", {
    state: "waiting_human",
    finishedAt: new Date(),
    resultJson: { handoff_id: h.id, skill_version: version.version },
  });
  await tracer?.flush();
  return { type: "waiting_human", handoffId: h.id };
}

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(tag)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** 加载启用的搜索供应商并构建 web 工具；无供应商返回 undefined */
export async function buildWebToolsIfConfigured() {
  try {
    const provs = await db.select().from(searchProviders).where(eq(searchProviders.status, "active"));
    if (provs.length === 0) return undefined;
    const router = new SearchRouter(
      provs.map((p) => ({ id: p.id, name: p.name, type: p.type as "brave" | "exa", apiKey: decryptSecret(p.apiKeyEncrypted) })),
      {
        persist: (id, patch) => {
          const { lastUsedAt, ...rest } = patch;
          db.update(searchProviders)
            .set({ ...rest, ...(lastUsedAt ? { lastUsedAt } : {}), lastCheckedAt: new Date(), updatedAt: new Date() })
            .where(eq(searchProviders.id, id))
            .catch(() => {});
        },
      },
    );
    const { webSearchTool, webFetchTool } = createWebTools(router);
    return [webSearchTool, webFetchTool];
  } catch (err) {
    console.warn("[worker] web tools init failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

export async function closeRedis() {
  await redis.quit().catch(() => {});
}
