import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  appendMessage,
  conversations,
  db,
  decryptSecret,
  searchProviders,
  createRunIdempotent,
  getOrCreateConversation,
  getSkillVersion,
  listMessages,
  resolveModel,
  transitionRun,
  ModelNotConfiguredError,
  type CustomerService,
} from "@honmono/db";
import * as storage from "@honmono/storage";
import { composeRuntimeSystemPrompt, createRunTracer, runRuntimeAgent, SearchRouter, createWebTools } from "@honmono/agent";
import { TestRunInput } from "@honmono/contracts";

const activeTestRuns = new Set<string>();

export async function runTestPlayground(
  c: Context,
  service: CustomerService,
  body: { content: string; use_draft: boolean; reset: boolean },
) {
  if (activeTestRuns.has(service.id)) {
    return c.json({ error: "test_busy", message: "该客服已有测试在运行，请等待完成" }, 409);
  }
  activeTestRuns.add(service.id);
  const release = () => activeTestRuns.delete(service.id);

  const conv = await getOrCreateConversation(service.id, "test", null);
  if (body.reset) {
    await db.update(conversations).set({ controlState: "ai" }).where(eq(conversations.id, conv.id));
  }
  const requestId = crypto.randomUUID();
  const { run } = await createRunIdempotent({
    requestId,
    serviceId: service.id,
    conversationId: conv.id,
    kind: "test",
    userContent: body.content,
  });

  return streamSSE(c, async (stream) => {
    const send = async (event: string, data: unknown) => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    };
    try {
      await send("run.status", { state: "queued", request_id: requestId });

      // 选择技能版本：draft 或 active
      const versionId = body.use_draft ? service.draftSkillVersionId : service.activeSkillVersionId;
      if (!versionId) {
        await send("error", { message: body.use_draft ? "草稿技能不存在" : "尚无已发布版本，请先完成配置" });
        await send("done", { status: "failed" });
        return;
      }
      const version = await getSkillVersion(versionId);
      if (!version) {
        await send("error", { message: "技能版本不存在" });
        await send("done", { status: "failed" });
        return;
      }
      await send("skill.loaded", { version: version.version, mode: body.use_draft ? "draft" : "active" });

      // 历史消息（不含本次）
      const history = await listMessages(conv.id, 0, 60);
      const chatTurns = history
        .filter((m) => m.id !== history.at(-1)?.id || m.role === "assistant")
        .slice(0, -1)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      let resolved;
      try {
        resolved = await resolveModel("runtime", service.id);
      } catch (err) {
        if (err instanceof ModelNotConfiguredError) {
          await send("error", { message: `模型未配置：${err.message}。请管理员在 /admin/llm 配置默认模型。` });
          await send("done", { status: "failed" });
          return;
        }
        throw err;
      }

      await transitionRun(run.id, run.state, { state: "running", startedAt: new Date(), skillVersionId: version.id, modelKey: resolved.modelKey });
      await send("run.status", { state: "running", request_id: requestId });

      const events: Array<{ type: string; name?: string; summary?: string }> = [];
      const tracer = await createRunTracer({
        traceName: "test.run",
        traceId: run.id,
        sessionId: `${service.id}:test`,
        tags: ["test"],
        metadata: { service_id: service.id, skill_version: version.version, model: resolved.modelKey },
      });

      const skillMd = await storage.readText(`${version.rootPath}/SKILL.md`);
      // 搜索供应商 → web 工具
      let extraTools: Parameters<typeof runRuntimeAgent>[0]["extraTools"];
      try {
        const provs = await db.select().from(searchProviders).where(eq(searchProviders.status, "active"));
        if (provs.length > 0) {
          const router = new SearchRouter(
            provs.map((p) => ({ id: p.id, name: p.name, type: p.type as "brave" | "exa", apiKey: decryptSecret(p.apiKeyEncrypted) })),
            {
              persist: (pid, patch) => {
                const { lastUsedAt, ...rest } = patch;
                db.update(searchProviders)
                  .set({ ...rest, ...(lastUsedAt ? { lastUsedAt } : {}), lastCheckedAt: new Date(), updatedAt: new Date() })
                  .where(eq(searchProviders.id, pid))
                  .catch(() => {});
              },
            },
          );
          const { webSearchTool, webFetchTool } = createWebTools(router, (e) =>
            events.push({ type: "tool.started", name: e.name, summary: e.summary } as { type: string }),
          );
          extraTools = [webSearchTool, webFetchTool];
        }
      } catch {
        extraTools = undefined;
      }
      const agentPromise = runRuntimeAgent({
        model: (await import("@honmono/agent")).createChatModel(resolved),
        modelKey: resolved.modelKey,
        skillRootDir: storage.resolveWithin(version.rootPath),
        skillMarkdown: skillMd,
        chatMessages: [...chatTurns, { role: "user", content: body.content }],
        extraTools,
        onEvent: (e) => events.push(e as { type: string }),
        callbacks: (tracer ? [tracer.handler] : []) as unknown as undefined | import("@langchain/core/callbacks/manager").Callbacks,
      }).finally(release);

      // 边执行边推送工具事件
      let agentSettled = false;
      agentPromise.then(
        () => (agentSettled = true),
        () => (agentSettled = true),
      );
      let flushed = 0;
      while (!agentSettled || flushed < events.length) {
        if (flushed < events.length) {
          const e = events[flushed++];
          if (e.type === "tool.started") await send("tool.started", { name: (e as { name?: string }).name, summary: (e as { summary?: string }).summary });
        } else {
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      const outcome = await agentPromise;
      const result =
        outcome.kind === "response"
          ? outcome
          : { text: "", sleepSeconds: 0, askHuman: outcome };

      if (outcome.kind === "response") {
        // 持久化 + 增量推送
        await appendMessage({
          conversationId: conv.id,
          serviceId: service.id,
          role: "assistant",
          authorType: "ai",
          content: outcome.text,
          runId: run.id,
        });
        const chunkSize = 24;
        for (let i = 0; i < outcome.text.length; i += chunkSize) {
          await send("response.delta", { text: outcome.text.slice(i, i + chunkSize) });
        }
        await transitionRun(run.id, "running", {
          state: "succeeded",
          finishedAt: new Date(),
          resultJson: { content: outcome.text, skill_version: version.version },
        });
        await send("done", { status: "completed", trace_id: run.id });
      } else {
        // ask_human：测试台也创建求助，完整走人工流程
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
        await send("ask_human", { handoff_id: h.id, reason: outcome.reason, question: outcome.question, suggested_replies: outcome.suggestedReplies });
        await send("done", { status: "waiting_for_human", trace_id: run.id });
      }
      await tracer?.flush();
    } catch (err) {
      await send("error", { message: err instanceof Error ? err.message : String(err) });
      await send("done", { status: "failed" });
      await transitionRun(run.id, run.state, { state: "failed", finishedAt: new Date(), errorMessage: err instanceof Error ? err.message : String(err) }).catch(() => {});
    } finally {
      release();
    }
  });
}
