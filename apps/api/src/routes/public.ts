import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import {
  appendMessage,
  countBusyRuns,
  conversations,
  customerServices,
  db,
  findApiKeyBySecret,
  getOrCreateConversation,
  getRunByRequest,
  createRunIdempotent,
  getSetting,
  listMessages,
  messages,
  supersedeWaitingRun,
  touchApiKey,
  runs,
} from "@honmono/db";
import { ChatInput } from "@honmono/contracts";
import { getQueue } from "../queues.js";
import type { AppEnv } from "../env.js";

export const publicRoutes = new Hono<AppEnv>();

function bearerOf(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

publicRoutes.post("/customer-services/:id/chat", async (c) => {
  const secret = bearerOf(c.req.header("Authorization"));
  if (!secret) return c.json({ error: "unauthorized", message: "缺少 API Key" }, 401);
  const key = await findApiKeyBySecret(secret);
  if (!key) return c.json({ error: "unauthorized", message: "API Key 无效" }, 401);
  const [service] = await db.select().from(customerServices).where(eq(customerServices.id, c.req.param("id"))).limit(1);
  if (!service || service.status === "deleted") return c.json({ error: "not_found", message: "客服不存在" }, 404);
  if (key.serviceId !== service.id) return c.json({ error: "forbidden", message: "API Key 与该客服不匹配" }, 403);
  if (service.status === "disabled") return c.json({ error: "service_disabled", message: "客服已停用" }, 409);
  if (service.status !== "ready") return c.json({ error: "service_not_ready", message: "客服尚未完成配置" }, 409);
  await touchApiKey(key.id);

  const body = ChatInput.parse(await c.req.json());

  // 同一 request_id 幂等：已有 Run 则直接返回其当前状态
  const existing = await getRunByRequest(service.id, body.request_id);
  if (existing) {
    return c.json(await terminalOrProgress(service.id, body.conversation_id, existing.requestId, existing.state, existing.id));
  }

  const conv = await getOrCreateConversation(service.id, "production", body.conversation_id);

  // 人工接管中：消息入库，不触发 AI
  if (conv.controlState === "human_controlled") {
    for (const m of body.messages) {
      if (m.role === "user") await appendMessage({ conversationId: conv.id, serviceId: service.id, role: "user", authorType: "end_user", content: m.content });
    }
    return c.json({ request_id: body.request_id, conversation_id: body.conversation_id, status: "human_controlled" });
  }

  // waiting_input 的 Run 被新消息取代
  const superseded = await supersedeWaitingRun(conv.id);

  const queueFullLimit = await getSetting("queue_full_limit", 20);
  const busy = await countBusyRuns();
  const willReplaceWaiting = Boolean(superseded);
  if (busy >= queueFullLimit && !willReplaceWaiting) {
    return c.json(
      { error: "queue_full", message: "队列已满，请稍后重试", retry_after: 5 },
      429,
    );
  }

  const lastMsg = body.messages.at(-1)!;
  const { run, created } = await createRunIdempotent({
    requestId: body.request_id,
    serviceId: service.id,
    conversationId: conv.id,
    kind: "production",
    userContent: lastMsg.content,
  });
  if (created) {
    if (superseded) {
      // 记录取代关系，供旧 Run 的长连接返回
      await db
        .update(runs)
        .set({ resultJson: { ...((superseded.resultJson as object | null) ?? {}), superseded_by: run.requestId } })
        .where(eq(runs.id, superseded.id));
    }
    await getQueue("chat").add(
      "chat-run",
      { runId: run.id, endUserId: body.metadata?.end_user_id ?? null },
      { jobId: run.id, removeOnComplete: 100, removeOnFail: 500 },
    );
  }
  return c.json(await terminalOrProgress(service.id, body.conversation_id, run.requestId, run.state, run.id, true));
});

/** 阻塞等待 Run 终态并返回完整 JSON（生产 /chat 语义） */
async function terminalOrProgress(
  serviceId: string,
  conversationExternalId: string,
  requestId: string,
  state: string,
  runId: string,
  wait = false,
): Promise<unknown> {
  const timeoutSeconds = await getSetting("chat_run_timeout_seconds", 180);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let current = state;
  let currentRunId = runId;

  // 若该 request 换了 run（幂等重试），重新定位
  const locate = async () => {
    const r = await getRunByRequest(serviceId, requestId);
    if (r) {
      current = r.state;
      currentRunId = r.id;
    }
  };

  while (true) {
    if (["succeeded", "waiting_human", "superseded", "failed"].includes(current) || current === "human_controlled") break;
    if (!wait) break;
    if (Date.now() > deadline) {
      return {
        request_id: requestId,
        conversation_id: conversationExternalId,
        status: "timeout",
        detail: "运行仍在进行，可稍后用状态接口查询",
      };
    }
    await sleep(600);
    await locate();
    if (current === "queued" || current === "running" || current === "waiting_input" || current === "waiting_human") continue;
    break;
  }

  if (current === "succeeded") {
    const runRow = await getRunByRequest(serviceId, requestId);
    const result = runRow?.resultJson as { content?: string } | null;
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.externalId, conversationExternalId), eq(conversations.serviceId, serviceId)))
      .limit(1);
    // 以消息表中该 Run 产出的 assistant 回复为准（人工接管后可能已被人工消息覆盖语义）
    let content = result?.content ?? "";
    if (conv) {
      const [runAssistant] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conv.id), eq(messages.role, "assistant"), eq(messages.runId, currentRunId)))
        .limit(1);
      if (runAssistant) content = runAssistant.content;
    }
    return {
      request_id: requestId,
      conversation_id: conversationExternalId,
      status: "completed",
      message: { role: "assistant", content },
      run: {
        skill_version: (runRow?.resultJson as { skill_version?: number } | null)?.skill_version ?? null,
        trace_id: runRow?.traceId ?? null,
        started_at: runRow?.startedAt ?? null,
        finished_at: runRow?.finishedAt ?? null,
      },
    };
  }
  if (current === "waiting_human") {
    const { handoffs } = await import("@honmono/db");
    const [h] = await db
      .select()
      .from(handoffs)
      .where(eq(handoffs.runId, currentRunId))
      .limit(1);
    return {
      request_id: requestId,
      conversation_id: conversationExternalId,
      status: "waiting_for_human",
      handoff_id: h?.id ?? null,
    };
  }
  if (current === "superseded") {
    const runRow = await getRunByRequest(serviceId, requestId);
    const supersededBy = (runRow?.resultJson as { superseded_by?: string } | null)?.superseded_by ?? null;
    return {
      request_id: requestId,
      conversation_id: conversationExternalId,
      status: "superseded",
      superseded_by: supersededBy,
    };
  }
  if (current === "failed") {
    const runRow = await getRunByRequest(serviceId, requestId);
    return {
      request_id: requestId,
      conversation_id: conversationExternalId,
      status: "agent_failed",
      detail: runRow?.errorMessage ?? "运行失败",
      trace_id: runRow?.traceId ?? null,
    };
  }
  // queued/running/waiting_input/waiting_human（不等待模式）
  return {
    request_id: requestId,
    conversation_id: conversationExternalId,
    status: current,
  };
}

publicRoutes.get("/customer-services/:id/runs/:requestId", async (c) => {
  const secret = bearerOf(c.req.header("Authorization"));
  if (!secret) return c.json({ error: "unauthorized", message: "缺少 API Key" }, 401);
  const key = await findApiKeyBySecret(secret);
  if (!key) return c.json({ error: "unauthorized", message: "API Key 无效" }, 401);
  const [service] = await db.select().from(customerServices).where(eq(customerServices.id, c.req.param("id"))).limit(1);
  if (!service || key.serviceId !== service.id) return c.json({ error: "forbidden" }, 403);
  const run = await getRunByRequest(service.id, c.req.param("requestId"));
  if (!run) return c.json({ error: "not_found" }, 404);
  return c.json({
    request_id: run.requestId,
    state: run.state,
    queue_reason: run.queueReason,
    queued_at: run.createdAt,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    result: ["succeeded", "waiting_human", "superseded", "failed"].includes(run.state) ? run.resultJson : null,
  });
});

/** 公开会话消息增量查询：获取人工回复等后续消息 */
publicRoutes.get("/customer-services/:id/conversations/:cid/messages", async (c) => {
  const secret = bearerOf(c.req.header("Authorization"));
  if (!secret) return c.json({ error: "unauthorized", message: "缺少 API Key" }, 401);
  const key = await findApiKeyBySecret(secret);
  if (!key) return c.json({ error: "unauthorized", message: "API Key 无效" }, 401);
  const [service] = await db.select().from(customerServices).where(eq(customerServices.id, c.req.param("id"))).limit(1);
  if (!service || key.serviceId !== service.id) return c.json({ error: "forbidden" }, 403);
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.serviceId, service.id), eq(conversations.channel, "production"), eq(conversations.externalId, c.req.param("cid"))))
    .limit(1);
  if (!conv) return c.json({ error: "not_found" }, 404);
  const after = Number(c.req.query("after") ?? 0);
  const msgs = await listMessages(conv.id, Number.isFinite(after) ? after : 0);
  return c.json({
    control_state: conv.controlState,
    messages: msgs.map((m) => ({
      id: Number(m.id),
      role: m.role,
      author_type: m.authorType,
      content: m.content,
      created_at: m.createdAt,
    })),
  });
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
