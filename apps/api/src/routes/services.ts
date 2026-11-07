import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  db,
  apiKeys,
  conversations,
  customerServices,
  handoffs,
  messages,
  skillVersions,
  uploads,
  appendMessage,
  createRunIdempotent,
  getOrCreateConversation,
  getActiveRun,
  getRunById,
  listMessages,
  getMerchant,
  getService,
  sha256Hex,
} from "@honmono/db";
import * as storage from "@honmono/storage";
import {
  ApiKeyCreateInput,
  ConfigMessageInput,
  HandoffReplyInput,
  CreateServiceInput,
} from "@honmono/contracts";
import { getQueue } from "../queues.js";
import { runTestPlayground } from "../test-playground.js";
import type { AppEnv } from "../env.js";

export const serviceRoutes = new Hono<AppEnv>();

// 所有路由都要求商户会话（中间件在 index.ts 挂）
serviceRoutes.use("*", async (c, next) => {
  if (!c.get("merchant")) return c.json({ error: "unauthorized" }, 401);
  await next();
});

async function requireOwnedService(serviceId: string, merchantId: string) {
  const service = await getService(serviceId);
  if (!service || service.merchantId !== merchantId || service.status === "deleted") return null;
  return service;
}

// ---------- 列表 / 创建 ----------
serviceRoutes.get("/", async (c) => {
  const merchantId = c.get("merchant")!.sub;
  const rows = await db
    .select()
    .from(customerServices)
    .where(and(eq(customerServices.merchantId, merchantId), sql`${customerServices.status} != 'deleted'`))
    .orderBy(desc(customerServices.createdAt));
  return c.json(rows.map((r) => ({ id: r.id, name: r.name, status: r.status, createdAt: r.createdAt })));
});

serviceRoutes.post("/", async (c) => {
  const merchantId = c.get("merchant")!.sub;
  const merchant = await getMerchant(merchantId);
  if (!merchant) return c.json({ error: "unauthorized" }, 401);
  const body = CreateServiceInput.safeParse(await c.req.json().catch(() => ({})));
  const name = body.success && body.data.name ? body.data.name : "新建客服";
  const count = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customerServices)
    .where(and(eq(customerServices.merchantId, merchantId), sql`${customerServices.status} != 'deleted'`));
  const svcName = body.success && body.data.name ? name : `客服 ${((count[0]?.n ?? 0) + 1).toString().padStart(2, "0")}`;

  // 草稿版本 v1，从模板复制
  const draftVersionNo = 1;
  const [draft] = await db
    .insert(skillVersions)
    .values({ serviceId: "00000000-0000-0000-0000-000000000000", version: draftVersionNo, kind: "draft", rootPath: "" })
    .returning();
  const [service] = await db
    .insert(customerServices)
    .values({ merchantId, name: svcName, draftSkillVersionId: draft.id })
    .returning();
  await db.update(skillVersions).set({ serviceId: service.id, rootPath: storage.draftDir(merchantId, service.id, draftVersionNo) }).where(eq(skillVersions.id, draft.id));

  // 落盘模板
  const templateRoot = process.env.SKILL_TEMPLATE_DIR ?? new URL("../../../../skills/create-customer-service/assets/service-skill-template", import.meta.url).pathname;
  const draftRoot = storage.resolveWithin(storage.draftDir(merchantId, service.id, draftVersionNo));
  const fs = await import("node:fs/promises");
  await fs.mkdir(storage.resolveWithin(storage.incomingDir(merchantId, service.id)), { recursive: true });
  await fs.cp(templateRoot, draftRoot, { recursive: true });
  // 注入配置 Agent 的采访指南（draft-only，发布时剔除）
  const guidesSrc = new URL("../../../../skills/create-customer-service/references", import.meta.url).pathname;
  await fs.cp(guidesSrc, `${draftRoot}/_guides`, { recursive: true });

  // 配置会话 + Agent 欢迎语（由 worker 首轮触发；这里先写一条引导消息）
  await getOrCreateConversation(service.id, "config", null);
  return c.json({ id: service.id, name: service.name, status: service.status });
});

serviceRoutes.get("/:id", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const draft = service.draftSkillVersionId
    ? (await db.select().from(skillVersions).where(eq(skillVersions.id, service.draftSkillVersionId)).limit(1))[0]
    : null;
  const active = service.activeSkillVersionId
    ? (await db.select().from(skillVersions).where(eq(skillVersions.id, service.activeSkillVersionId)).limit(1))[0]
    : null;
  return c.json({
    id: service.id,
    name: service.name,
    status: service.status,
    draft: draft ? { id: draft.id, version: draft.version, readiness: draft.readinessJson, manifest: draft.manifestJson } : null,
    active: active ? { id: active.id, version: active.version, publishedAt: active.publishedAt } : null,
  });
});

serviceRoutes.patch("/:id", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const body = z.object({ name: z.string().min(1).max(64) }).parse(await c.req.json());
  await db.update(customerServices).set({ name: body.name, updatedAt: new Date() }).where(eq(customerServices.id, service.id));
  return c.json({ ok: true });
});

// ---------- 配置聊天 ----------
serviceRoutes.post("/:id/config/messages", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  if (service.status === "disabled") return c.json({ error: "service_disabled", message: "客服已停用" }, 409);
  const body = ConfigMessageInput.parse(await c.req.json());
  const conv = await getOrCreateConversation(service.id, "config", null);
  const { run, created } = await createRunIdempotent({
    requestId: crypto.randomUUID(),
    serviceId: service.id,
    conversationId: conv.id,
    kind: "configuration",
    userContent: body.content,
  });
  if (created) await getQueue("config").add("config-run", { runId: run.id }, { jobId: run.id, removeOnComplete: 50, removeOnFail: 200 });
  return c.json({ run_id: run.id, state: run.state });
});

serviceRoutes.get("/:id/config/messages", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const conv = await getOrCreateConversation(service.id, "config", null);
  const after = Number(c.req.query("after") ?? 0);
  const msgs = await listMessages(conv.id, Number.isFinite(after) ? after : 0);
  const activeRun = await getActiveRun(conv.id);
  const latestRunState = activeRun ? activeRun.state : null;
  const latestRunId = activeRun ? activeRun.id : null;
  return c.json({
    messages: msgs.map((m) => ({ id: Number(m.id), role: m.role, author_type: m.authorType, content: m.content, created_at: m.createdAt })),
    run: latestRunId ? { id: latestRunId, state: latestRunState } : null,
  });
});

// ---------- 文件上传 ----------
serviceRoutes.post("/:id/files", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const merchantId = service.merchantId;
  const maxFiles = await import("@honmono/db").then((m) => m.getSetting("max_files_per_service", 50));
  const [{ n: fileCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(uploads)
    .where(and(eq(uploads.serviceId, service.id), sql`${uploads.parseStatus} != 'removed'`));
  const form = await c.req.parseBody({ all: true });
  const files = Object.values(form).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is File => v instanceof File);
  if (files.length === 0) return c.json({ error: "no_files", message: "未收到文件" }, 400);
  if (fileCount + files.length > maxFiles) return c.json({ error: "too_many_files", message: `最多 ${maxFiles} 个文件` }, 400);
  const maxFileMb = await import("@honmono/db").then((m) => m.getSetting("max_file_mb", 20));
  const saved: string[] = [];
  for (const file of files) {
    if (file.size > maxFileMb * 1024 * 1024) {
      saved.push(...(await saveUpload(service.id, merchantId, file, true, `超过大小限制 ${maxFileMb}MB`).then((u) => [u.id])));
      continue;
    }
    const up = await saveUpload(service.id, merchantId, file, false, null);
    saved.push(up.id);
    await getQueue("files").add("parse", { uploadId: up.id }, { jobId: up.id, removeOnComplete: 100, removeOnFail: 200 });
  }
  return c.json({ ok: true, upload_ids: saved });
});

async function saveUpload(serviceId: string, merchantId: string, file: File, quarantine: boolean, reason: string | null) {
  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_").slice(0, 120) || "file";
  const dir = quarantine ? storage.quarantineDir(merchantId, serviceId) : storage.incomingDir(merchantId, serviceId);
  const storedRel = `${dir}/${crypto.randomUUID()}-${safeName}`;
  await storage.writeBinary(storedRel, buf);
  const [up] = await db
    .insert(uploads)
    .values({
      serviceId,
      originalName: safeName,
      storedPath: storedRel,
      mime: file.type || null,
      size: buf.length,
      sha256: storage.sha256OfBuffer(buf),
      parseStatus: quarantine ? "failed" : "pending",
      parseReport: quarantine ? { reason } : null,
    })
    .returning();
  return up;
}

// 草稿工作目录文件树（供前端展示 Skill 生成过程）
serviceRoutes.get("/:id/files/tree", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const draftVersionId = service.draftSkillVersionId;
  if (!draftVersionId) return c.json({ files: [] });
  const draft = (await db.select().from(skillVersions).where(eq(skillVersions.id, draftVersionId)).limit(1))[0];
  if (!draft) return c.json({ files: [] });
  const entries = await storage.listTree(draft.rootPath);
  return c.json({
    root: `drafts/v${draft.version}`,
    files: entries.map((e) => ({ path: e, dir: e.endsWith("/") })),
  });
});

// 草稿文件内容保存（工作台编辑器）
serviceRoutes.put("/:id/files/content", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const draftVersionId = service.draftSkillVersionId;
  if (!draftVersionId) return c.json({ error: "not_found", message: "草稿不存在" }, 404);
  const draft = (await db.select().from(skillVersions).where(eq(skillVersions.id, draftVersionId)).limit(1))[0];
  if (!draft) return c.json({ error: "not_found", message: "草稿不存在" }, 404);
  const body = z
    .object({
      path: z.string().min(1).max(300).regex(/^[\w.\-/\u4e00-\u9fa5]+$/, "路径包含非法字符"),
      content: z.string().max(512 * 1024),
    })
    .parse(await c.req.json());
  const rel = body.path.replace(/^\/+/, "");
  try {
    const draftAbs = storage.resolveWithin(draft.rootPath);
    const abs = storage.resolveWithin(`${draft.rootPath}/${rel}`);
    if (!abs.startsWith(draftAbs) || abs === draftAbs) return c.json({ error: "forbidden", message: "路径越界" }, 403);
    await storage.writeText(`${draft.rootPath}/${rel}`, body.content);
    return c.json({ ok: true, path: rel, saved_at: new Date().toISOString() });
  } catch (err) {
    return c.json({ error: "forbidden", message: err instanceof Error ? err.message : "保存失败" }, 403);
  }
});

// 草稿文件内容预览（只读；路径强制围栏在草稿目录内）
serviceRoutes.get("/:id/files/preview", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const draftVersionId = service.draftSkillVersionId;
  if (!draftVersionId) return c.json({ error: "not_found" }, 404);
  const draft = (await db.select().from(skillVersions).where(eq(skillVersions.id, draftVersionId)).limit(1))[0];
  if (!draft) return c.json({ error: "not_found" }, 404);
  const rel = c.req.query("path") ?? "";
  try {
    const abs = storage.resolveWithin(`${draft.rootPath}/${rel.replace(/^\/+/, "")}`);
    // 双保险：解析后必须仍在草稿目录内
    const draftAbs = storage.resolveWithin(draft.rootPath);
    if (!abs.startsWith(draftAbs)) return c.json({ error: "forbidden" }, 403);
    const stat = await (await import("node:fs/promises")).stat(abs);
    if (stat.size > 512 * 1024) return c.json({ error: "too_large", message: "文件超过 512KB，仅支持预览更小的文本文件" }, 400);
    const content = await storage.readText(`${draft.rootPath}/${rel.replace(/^\/+/, "")}`);
    return c.json({ path: rel, content });
  } catch {
    return c.json({ error: "not_found", message: "文件不存在或不可读" }, 404);
  }
});

serviceRoutes.get("/:id/files", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const rows = await db.select().from(uploads).where(eq(uploads.serviceId, service.id)).orderBy(desc(uploads.createdAt));
  return c.json(
    rows.map((u) => ({
      id: u.id,
      name: u.originalName,
      size: u.size,
      mime: u.mime,
      parse_status: u.parseStatus,
      parse_report: u.parseReport,
      created_at: u.createdAt,
    })),
  );
});

// ---------- API Key ----------
serviceRoutes.get("/:id/api-keys", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.serviceId, service.id)).orderBy(desc(apiKeys.createdAt));
  return c.json(
    rows.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      revoked: Boolean(k.revokedAt),
      last_used_at: k.lastUsedAt,
      created_at: k.createdAt,
    })),
  );
});

serviceRoutes.post("/:id/api-keys", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const body = ApiKeyCreateInput.parse(await c.req.json());
  const secret = `cs_live_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const [key] = await db
    .insert(apiKeys)
    .values({
      serviceId: service.id,
      name: body.name,
      prefix: secret.slice(0, 14),
      keyHash: sha256Hex(secret),
    })
    .returning();
  // 完整值只在创建时返回一次
  return c.json({ id: key.id, name: key.name, prefix: key.prefix, secret, created_at: key.createdAt });
});

serviceRoutes.delete("/:id/api-keys/:keyId", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, c.req.param("keyId")), eq(apiKeys.serviceId, service.id)));
  return c.json({ ok: true });
});

// ---------- 测试台（SSE） ----------
serviceRoutes.post("/:id/test-runs", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const body = z
    .object({
      content: z.string().min(1).max(8000),
      use_draft: z.boolean().default(true),
      reset: z.boolean().default(false),
    })
    .parse(await c.req.json());
  return runTestPlayground(c, service, body);
});

// ---------- 人工求助 ----------
serviceRoutes.get("/:id/handoffs", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const rows = await db
    .select()
    .from(handoffs)
    .where(eq(handoffs.serviceId, service.id))
    .orderBy(desc(handoffs.createdAt))
    .limit(50);
  const out = [];
  for (const h of rows) {
    const conv = (await db.select().from(conversations).where(eq(conversations.id, h.conversationId)).limit(1))[0];
    const convMsgs = await listMessages(h.conversationId, 0, 30);
    const openHandoffExists = h.state === "pending" || h.state === "human_controlled";
    out.push({
      id: h.id,
      conversation_id: h.conversationId,
      state: h.state,
      reason: h.reason,
      question: h.question,
      context_summary: h.contextSummary,
      suggested_replies: h.suggestedReplies,
      conversation_control_state: conv?.controlState,
      created_at: h.createdAt,
      resolved_at: h.resolvedAt,
      messages: convMsgs.map((m) => ({ id: Number(m.id), role: m.role, author_type: m.authorType, content: m.content, created_at: m.createdAt })),
      _open: openHandoffExists,
    });
  }
  return c.json(out);
});

// 选择建议回复 / 编辑后发送（assisted reply）→ 恢复 AI
serviceRoutes.post("/:id/handoffs/:hid/reply", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const body = HandoffReplyInput.parse(await c.req.json());
  const [h] = await db
    .select()
    .from(handoffs)
    .where(and(eq(handoffs.id, c.req.param("hid")), eq(handoffs.serviceId, service.id)))
    .limit(1);
  if (!h) return c.json({ error: "not_found" }, 404);
  if (h.state !== "pending") return c.json({ error: "invalid_state", message: "求助不在待处理状态" }, 409);
  await appendMessage({
    conversationId: h.conversationId,
    serviceId: service.id,
    role: "assistant",
    authorType: "human",
    content: body.text,
  });
  await db.update(handoffs).set({ state: "assisted_reply", resolvedAt: new Date() }).where(eq(handoffs.id, h.id));
  await db.update(conversations).set({ controlState: "ai" }).where(eq(conversations.id, h.conversationId));
  return c.json({ ok: true });
});

// 直接接管
serviceRoutes.post("/:id/handoffs/:hid/takeover", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const [h] = await db
    .select()
    .from(handoffs)
    .where(and(eq(handoffs.id, c.req.param("hid")), eq(handoffs.serviceId, service.id)))
    .limit(1);
  if (!h) return c.json({ error: "not_found" }, 404);
  if (h.state !== "pending") return c.json({ error: "invalid_state", message: "求助不在待处理状态" }, 409);
  await db.update(handoffs).set({ state: "human_controlled" }).where(eq(handoffs.id, h.id));
  await db.update(conversations).set({ controlState: "human_controlled" }).where(eq(conversations.id, h.conversationId));
  return c.json({ ok: true });
});

// 接管中的会话：商户手动回复
serviceRoutes.post("/:id/conversations/:cid/reply", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const body = HandoffReplyInput.parse(await c.req.json());
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, c.req.param("cid")), eq(conversations.serviceId, service.id)))
    .limit(1);
  if (!conv) return c.json({ error: "not_found" }, 404);
  if (conv.controlState !== "human_controlled") return c.json({ error: "invalid_state", message: "会话不在人工接管状态" }, 409);
  await appendMessage({
    conversationId: conv.id,
    serviceId: service.id,
    role: "assistant",
    authorType: "human",
    content: body.text,
  });
  return c.json({ ok: true });
});

// 交还 AI
serviceRoutes.post("/:id/conversations/:cid/release", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, c.req.param("cid")), eq(conversations.serviceId, service.id)))
    .limit(1);
  if (!conv) return c.json({ error: "not_found" }, 404);
  await db.update(conversations).set({ controlState: "ai" }).where(eq(conversations.id, conv.id));
  await db
    .update(handoffs)
    .set({ state: "resolved", resolvedAt: new Date() })
    .where(and(eq(handoffs.conversationId, conv.id), sql`${handoffs.state} = 'human_controlled'`));
  return c.json({ ok: true });
});

// 会话消息（商户查看生产会话）
serviceRoutes.get("/:id/conversations/:cid/messages", async (c) => {
  const service = await requireOwnedService(c.req.param("id"), c.get("merchant")!.sub);
  if (!service) return c.json({ error: "not_found" }, 404);
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, c.req.param("cid")), eq(conversations.serviceId, service.id)))
    .limit(1);
  if (!conv) return c.json({ error: "not_found" }, 404);
  const after = Number(c.req.query("after") ?? 0);
  const msgs = await listMessages(conv.id, Number.isFinite(after) ? after : 0);
  return c.json({
    control_state: conv.controlState,
    messages: msgs.map((m) => ({ id: Number(m.id), role: m.role, author_type: m.authorType, content: m.content, created_at: m.createdAt })),
  });
});
