import { and, desc, eq, sql } from "drizzle-orm";
import {
  appendMessage,
  conversations,
  customerServices,
  db,
  getOrCreateConversation,
  getRunById,
  getSkillVersion,
  listMessages,
  resolveModel,
  skillVersions,
  transitionRun,
  ModelNotConfiguredError,
} from "@honmono/db";
import * as storage from "@honmono/storage";
import { createChatModel, createRunTracer, runConfigAgent, type ChatTurn } from "@honmono/agent";
// @ts-expect-error — 纯 mjs 校验脚本（确定性校验，无类型声明）
import { validateSkillDir } from "../../../skills/create-customer-service/scripts/validate-skill.mjs";

export async function executeConfigRun(runId: string): Promise<void> {
  const run = await getRunById(runId);
  if (!run || run.state !== "queued") return;

  const service = (await db.select().from(customerServices).where(eq(customerServices.id, run.serviceId)).limit(1))[0];
  if (!service || service.status === "deleted") {
    await transitionRun(runId, "queued", { state: "failed", errorCode: "service_missing", finishedAt: new Date() });
    return;
  }
  const draftVersion = service.draftSkillVersionId ? await getSkillVersion(service.draftSkillVersionId) : null;
  if (!draftVersion) {
    await transitionRun(runId, "queued", { state: "failed", errorCode: "draft_missing", finishedAt: new Date() });
    return;
  }

  const moved = await transitionRun(runId, "queued", { state: "running", startedAt: new Date() });
  if (!moved) return;

  const conv = await getOrCreateConversation(service.id, "config", null);

  try {
    const resolved = await resolveModel("configuration", service.id);

    const draftRootAbs = storage.resolveWithin(draftVersion.rootPath);

    // readiness 校验（确定性，服务端实现）
    const doValidate = async () => {
      const res = await validateSkillDir(draftRootAbs);
      await db
        .update(skillVersions)
        .set({ readinessJson: res as object })
        .where(eq(skillVersions.id, draftVersion.id));
      return { ok: res.ok as boolean, readiness: res.readiness as object, blockers: res.blockers as string[] };
    };

    // 发布：校验 → 复制草稿为不可变版本 → 事务切换 active
    const doPublish = async () => {
      const check = await validateSkillDir(draftRootAbs);
      await db.update(skillVersions).set({ readinessJson: check as object }).where(eq(skillVersions.id, draftVersion.id));
      if (!check.ok) {
        return { ok: false as const, message: `校验未通过：${check.blockers.join("；")}` };
      }
      const [latest] = await db
        .select({ v: sql<number>`coalesce(max(${skillVersions.version}), 0)::int` })
        .from(skillVersions)
        .where(and(eq(skillVersions.serviceId, service.id), eq(skillVersions.kind, "published")));
      const nextVersion = (latest?.v ?? 0) + 1;
      const newRootRel = storage.versionDir(service.merchantId, service.id, nextVersion);
      await storage.copyRecursively(draftVersion.rootPath, newRootRel);
      const files = await storage.listTree(newRootRel);

      const result = await db.transaction(async (tx) => {
        const [published] = await tx
          .insert(skillVersions)
          .values({
            serviceId: service.id,
            version: nextVersion,
            kind: "published",
            rootPath: newRootRel,
            readinessJson: check as object,
            manifestJson: { files, generated_at: new Date().toISOString() },
            publishedAt: new Date(),
          })
          .returning();
        await tx
          .update(customerServices)
          .set({
            activeSkillVersionId: published.id,
            status: "ready",
            updatedAt: new Date(),
          })
          .where(eq(customerServices.id, service.id));
        return published;
      });
      return { ok: true as const, version: result.version, message: `已发布 v${result.version}` };
    };

    const tracer = await createRunTracer({
      traceName: "configuration.run",
      traceId: run.id,
      sessionId: `${service.id}:config`,
      tags: ["configuration"],
      metadata: {
        service_id: service.id,
        merchant_id: service.merchantId,
        draft_version: draftVersion.version,
        model: resolved.modelKey,
      },
    });

    const history = await listMessages(conv.id, 0, 60);
    const chatTurns: ChatTurn[] = [];
    for (const m of history.slice(-30)) {
      if (m.role === "user" && m.authorType === "merchant") chatTurns.push({ role: "user", content: m.content });
      else if (m.role === "assistant") chatTurns.push({ role: "assistant", content: m.content });
      else if (m.role === "system") chatTurns.push({ role: "user", content: `[系统通知] ${m.content}` });
    }
    // 最后一条 queued 的用户消息已包含在 history 中

    const instruction = await loadCreateCustomerServiceSkill();

    const { reply } = await runConfigAgent({
      model: createChatModel(resolved),
      modelKey: resolved.modelKey,
      draftRootDir: draftRootAbs,
      instructionMarkdown: instruction,
      chatMessages: chatTurns,
      onValidate: doValidate,
      onPublish: doPublish,
      callbacks: (tracer ? [tracer.handler] : []) as unknown as undefined,
    });

    await appendMessage({
      conversationId: conv.id,
      serviceId: service.id,
      role: "assistant",
      authorType: "ai",
      content: reply,
      runId: run.id,
    });
    await transitionRun(runId, "running", {
      state: "succeeded",
      finishedAt: new Date(),
      modelKey: resolved.modelKey,
      providerConfigVersion: resolved.configVersion,
      skillVersionId: draftVersion.id,
      resultJson: { reply },
    });
    await tracer?.flush();
  } catch (err) {
    const code = err instanceof ModelNotConfiguredError ? "model_not_configured" : "config_agent_failed";
    await transitionRun(runId, "running", {
      state: "failed",
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
      finishedAt: new Date(),
    });
    // 给商户一个可见的错误提示
    await appendMessage({
      conversationId: conv.id,
      serviceId: service.id,
      role: "assistant",
      authorType: "system",
      content: "配置处理出现问题，请稍后重试；若持续出现请联系平台管理员。",
    }).catch(() => {});
  }
}

async function loadCreateCustomerServiceSkill(): Promise<string> {
  const explicit = process.env.CREATE_SERVICE_SKILL_PATH;
  const path = explicit ?? new URL("../../../skills/create-customer-service/SKILL.md", import.meta.url).pathname;
  const fs = await import("node:fs/promises");
  return fs.readFile(path, "utf8");
}

export { conversations };
