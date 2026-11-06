import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./client.js";
import {
  adminAuditLogs,
  apiKeys,
  conversations,
  customerServices,
  handoffs,
  llmModels,
  llmProviders,
  messages,
  modelAssignments,
  merchants,
  platformSettings,
  runs,
  skillVersions,
} from "./schema.js";
import { decryptSecret, sha256Hex } from "./crypto.js";

// ============ 会话 ============
export async function getOrCreateConversation(
  serviceId: string,
  channel: "production" | "test" | "config",
  externalId: string | null,
) {
  const found = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.serviceId, serviceId),
        eq(conversations.channel, channel),
        externalId === null ? isNull(conversations.externalId) : eq(conversations.externalId, externalId),
      ),
    )
    .limit(1);
  if (found[0]) return found[0];
  const inserted = await db
    .insert(conversations)
    .values({ serviceId, channel, externalId })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const again = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.serviceId, serviceId),
        eq(conversations.channel, channel),
        externalId === null ? isNull(conversations.externalId) : eq(conversations.externalId, externalId),
      ),
    )
    .limit(1);
  return again[0]!;
}

export async function appendMessage(input: {
  conversationId: string;
  serviceId: string;
  role: "user" | "assistant" | "system";
  authorType: "end_user" | "ai" | "human" | "merchant" | "system";
  content: string;
  runId?: string | null;
}) {
  const [row] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      serviceId: input.serviceId,
      role: input.role,
      authorType: input.authorType,
      content: input.content,
      runId: input.runId ?? null,
    })
    .returning();
  return row;
}

export async function listMessages(conversationId: string, afterId = 0, limit = 200) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gt(messages.id, afterId)))
    .orderBy(asc(messages.id))
    .limit(limit);
}

// ============ Run 状态机 ============
export type RunKind = "production" | "test" | "configuration";

/**
 * 幂等创建 Run：同 serviceId+requestId 已存在则返回既有记录且不追加消息。
 * 仅在新创建时追加用户消息。
 */
export async function createRunIdempotent(input: {
  requestId: string;
  serviceId: string;
  conversationId: string;
  kind: RunKind;
  userContent: string;
  queueReason?: string | null;
}) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.serviceId, input.serviceId), eq(runs.requestId, input.requestId)))
      .limit(1);
    if (existing[0]) return { run: existing[0], created: false as const };

    const [run] = await tx
      .insert(runs)
      .values({
        requestId: input.requestId,
        serviceId: input.serviceId,
        conversationId: input.conversationId,
        kind: input.kind,
        state: "queued",
        queueReason: input.queueReason ?? null,
        inputSummary: input.userContent.slice(0, 300),
      })
      .returning();
    await tx.insert(messages).values({
      conversationId: input.conversationId,
      serviceId: input.serviceId,
      role: "user",
      authorType: input.kind === "configuration" ? "merchant" : "end_user",
      content: input.userContent,
      runId: run.id,
    });
    return { run, created: true as const };
  });
}

/** 原子状态迁移：expectedState 不匹配返回 null */
export async function transitionRun(
  runId: string,
  expectedState: string,
  patch: Partial<typeof runs.$inferInsert>,
) {
  const [row] = await db
    .update(runs)
    .set(patch)
    .where(and(eq(runs.id, runId), eq(runs.state, expectedState)))
    .returning();
  return row ?? null;
}

export async function getRun(runId: string) {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  return row ?? null;
}

export async function getRunByRequest(serviceId: string, requestId: string) {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.serviceId, serviceId), eq(runs.requestId, requestId)))
    .limit(1);
  return row ?? null;
}

export async function getRunById(runId: string) {
  return getRun(runId);
}

/**
 * waiting_input 的 Run 被同会话新消息取代（原子）。
 * 返回被取代的 Run；无等待中 Run 返回 null。
 */
export async function supersedeWaitingRun(conversationId: string) {
  const [row] = await db
    .update(runs)
    .set({ state: "superseded", finishedAt: new Date() })
    .where(and(eq(runs.conversationId, conversationId), eq(runs.state, "waiting_input")))
    .returning();
  return row ?? null;
}

/** 会话当前有效 Run（queued/running/waiting_input/waiting_human） */
export async function getActiveRun(conversationId: string) {
  const [row] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.conversationId, conversationId),
        inArray(runs.state, ["queued", "running", "waiting_input", "waiting_human"]),
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return row ?? null;
}

export async function countBusyRuns() {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runs)
    .where(inArray(runs.state, ["queued", "running"]));
  return row?.n ?? 0;
}

// ============ 客服与 Skill ============
export async function getService(serviceId: string) {
  const [row] = await db.select().from(customerServices).where(eq(customerServices.id, serviceId)).limit(1);
  return row ?? null;
}

export async function getSkillVersion(id: string) {
  const [row] = await db.select().from(skillVersions).where(eq(skillVersions.id, id)).limit(1);
  return row ?? null;
}

export async function getLatestPublishedVersion(serviceId: string) {
  const [row] = await db
    .select()
    .from(skillVersions)
    .where(and(eq(skillVersions.serviceId, serviceId), eq(skillVersions.kind, "published")))
    .orderBy(desc(skillVersions.version))
    .limit(1);
  return row ?? null;
}

// ============ API Key ============
export async function findApiKeyBySecret(secret: string) {
  const hash = sha256Hex(secret);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function touchApiKey(id: string) {
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
}

// ============ 模型解析 ============
export type ResolvedModel = {
  providerId: string;
  providerType: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  configVersion: number;
  modelId: string;
  modelKey: string;
  displayName: string;
  capabilities: { tool_call: boolean; vision: boolean; json: boolean; reasoning_summary: boolean };
};

/** 场景解析：客服覆盖 → 平台默认 → 报错 */
export async function resolveModel(scenario: "configuration" | "runtime", serviceId: string | null): Promise<ResolvedModel> {
  const candidates = serviceId
    ? await db
        .select()
        .from(modelAssignments)
        .where(
          and(
            eq(modelAssignments.scenario, scenario),
            eq(modelAssignments.status, "active"),
            sql`(${modelAssignments.serviceId} = ${serviceId} or ${modelAssignments.serviceId} is null)`,
          ),
        )
        .orderBy(desc(modelAssignments.serviceId), desc(modelAssignments.priority))
    : await db
        .select()
        .from(modelAssignments)
        .where(
          and(
            eq(modelAssignments.scenario, scenario),
            eq(modelAssignments.status, "active"),
            isNull(modelAssignments.serviceId),
          ),
        )
        .orderBy(desc(modelAssignments.priority));
  const assignment = candidates.find((c) => c.serviceId !== null) ?? candidates[0];
  if (!assignment) throw new ModelNotConfiguredError(`场景 ${scenario} 未配置默认模型`);
  const [model] = await db.select().from(llmModels).where(eq(llmModels.id, assignment.modelId)).limit(1);
  if (!model || model.status !== "active") throw new ModelNotConfiguredError("模型不存在或已停用");
  const [provider] = await db.select().from(llmProviders).where(eq(llmProviders.id, model.providerId)).limit(1);
  if (!provider || provider.status !== "active") throw new ModelNotConfiguredError("Provider 不存在或已停用");
  return {
    providerId: provider.id,
    providerType: provider.type,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: decryptSecret(provider.apiKeyEncrypted),
    configVersion: provider.configVersion,
    modelId: model.id,
    modelKey: model.modelKey,
    displayName: model.displayName,
    capabilities: model.capabilities as ResolvedModel["capabilities"],
  };
}

export class ModelNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelNotConfiguredError";
  }
}

// ============ Handoff ============
export async function getHandoff(id: string) {
  const [row] = await db.select().from(handoffs).where(eq(handoffs.id, id)).limit(1);
  return row ?? null;
}

// ============ 设置 ============
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, key)).limit(1);
  return row ? (row.valueJson as T) : fallback;
}

export async function setSetting(key: string, valueJson: unknown, updatedBy?: string) {
  await db
    .insert(platformSettings)
    .values({ key, valueJson: valueJson as object, updatedBy })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { valueJson: valueJson as object, updatedBy, updatedAt: new Date() },
    });
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(platformSettings);
  return Object.fromEntries(rows.map((r) => [r.key, r.valueJson]));
}

// ============ 商户 ============
export async function getMerchant(id: string) {
  const [row] = await db.select().from(merchants).where(eq(merchants.id, id)).limit(1);
  return row ?? null;
}

// ============ 审计 ============
export async function audit(input: {
  adminId?: string | null;
  adminEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  before?: unknown;
  after?: unknown;
  result?: string;
}) {
  await db.insert(adminAuditLogs).values({
    adminId: input.adminId ?? null,
    adminEmail: input.adminEmail ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    requestId: input.requestId ?? null,
    beforeJson: (input.before ?? null) as object,
    afterJson: (input.after ?? null) as object,
    result: input.result ?? "success",
  });
}
