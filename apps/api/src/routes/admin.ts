import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { hash } from "@node-rs/argon2";
import {
  searchProviders,
  adminAuditLogs,
  adminUsers,
  apiKeys,
  customerServices,
  db,
  encryptSecret,
  getAllSettings,
  llmModels,
  llmProviders,
  maskSecret,
  merchants,
  inviteCodes,
  modelAssignments,
  purchases,
  runs,
  audit,
  resolveModel,
  getMerchant,
  setSetting,
  handoffs,
  conversations,
  decryptSecret,
} from "@honmono/db";
import { createChatModel, SearchRouter, webFetch, type SearchProviderInfo } from "@honmono/agent";
import {
  AdminPasswordResetInput,
  AssignmentUpsertInput,
  InviteUpsertInput,
  ModelUpsertInput,
  ProviderUpsertInput,
  SettingsUpdateInput,
} from "@honmono/contracts";
import type { AppEnv } from "../env.js";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c, next) => {
  const admin = c.get("admin");
  if (!admin) return c.json({ error: "unauthorized" }, 401);
  await next();
});

// ---------- 概览 ----------
adminRoutes.get("/overview", async (c) => {
  const [[mer], [svcs], [runsRun], [pendHand], [provs]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(merchants),
    db.select({ n: sql<number>`count(*)::int` }).from(customerServices).where(sql`${customerServices.status} != 'deleted'`),
    db.select({ n: sql<number>`count(*)::int` }).from(runs).where(sql`${runs.state} in ('queued','running')`),
    db.select({ n: sql<number>`count(*)::int` }).from(handoffs).where(eq(handoffs.state, "pending")),
    db.select({ n: sql<number>`count(*)::int` }).from(llmProviders).where(eq(llmProviders.status, "active")),
  ]);
  return c.json({
    merchants: mer.n,
    services: svcs.n,
    active_runs: runsRun.n,
    pending_handoffs: pendHand.n,
    active_providers: provs.n,
  });
});

// ---------- 用户管理 ----------
adminRoutes.get("/users", async (c) => {
  const q = c.req.query("q");
  const rows = await db
    .select()
    .from(merchants)
    .where(q ? ilike(merchants.account, `%${q}%`) : sql`true`)
    .orderBy(desc(merchants.createdAt))
    .limit(100);
  const counts = await db
    .select({ merchantId: customerServices.merchantId, n: sql<number>`count(*)::int` })
    .from(customerServices)
    .where(sql`${customerServices.status} != 'deleted'`)
    .groupBy(customerServices.merchantId);
  const countMap = new Map(counts.map((r) => [r.merchantId, r.n]));
  const activated = new Set((await db.select().from(purchases)).map((p) => p.merchantId));
  return c.json(
    rows.map((m) => ({
      id: m.id,
      account: m.account,
      status: m.status,
      activated: activated.has(m.id),
      service_count: countMap.get(m.id) ?? 0,
      created_at: m.createdAt,
      last_login_at: m.lastLoginAt,
    })),
  );
});

adminRoutes.get("/users/:id", async (c) => {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, c.req.param("id"))).limit(1);
  if (!m) return c.json({ error: "not_found" }, 404);
  const services = await db.select().from(customerServices).where(and(eq(customerServices.merchantId, m.id), sql`${customerServices.status} != 'deleted'`));
  const redeem = await db
    .select({ p: purchases, prefix: inviteCodes.codePrefix })
    .from(purchases)
    .leftJoin(inviteCodes, eq(purchases.inviteCodeId, inviteCodes.id))
    .where(eq(purchases.merchantId, m.id));
  return c.json({
    id: m.id,
    account: m.account,
    status: m.status,
    created_at: m.createdAt,
    last_login_at: m.lastLoginAt,
    services: services.map((s) => ({ id: s.id, name: s.name, status: s.status })),
    purchases: redeem.map((r) => ({ redeemed_at: r.p.redeemedAt, invite_prefix: r.prefix })),
  });
});

adminRoutes.post("/users/:id/disable", async (c) => {
  const admin = c.get("admin")!;
  const [before] = await db.select().from(merchants).where(eq(merchants.id, c.req.param("id"))).limit(1);
  if (!before) return c.json({ error: "not_found" }, 404);
  await db.update(merchants).set({ status: "disabled" }).where(eq(merchants.id, before.id));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "user.disable", resourceType: "merchant", resourceId: before.id, before: { status: before.status }, after: { status: "disabled" } });
  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/enable", async (c) => {
  const admin = c.get("admin")!;
  await db.update(merchants).set({ status: "active" }).where(eq(merchants.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "user.enable", resourceType: "merchant", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/password-reset", async (c) => {
  const admin = c.get("admin")!;
  const body = AdminPasswordResetInput.parse(await c.req.json());
  const passwordHash = await hash(body.new_password);
  await db.update(merchants).set({ passwordHash }).where(eq(merchants.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "user.password_reset", resourceType: "merchant", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});

adminRoutes.delete("/users/:id", async (c) => {
  const admin = c.get("admin")!;
  await db.update(merchants).set({ status: "deleted" }).where(eq(merchants.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "user.delete", resourceType: "merchant", resourceId: c.req.param("id"), after: { soft_deleted: true } });
  return c.json({ ok: true });
});

// ---------- 客服管理 ----------
adminRoutes.get("/customer-services", async (c) => {
  const rows = await db
    .select({ s: customerServices, account: merchants.account })
    .from(customerServices)
    .leftJoin(merchants, eq(customerServices.merchantId, merchants.id))
    .where(sql`${customerServices.status} != 'deleted'`)
    .orderBy(desc(customerServices.createdAt))
    .limit(200);
  const activeRuns = await db.select({ serviceId: runs.serviceId, n: sql<number>`count(*)::int` }).from(runs).where(sql`${runs.state} in ('queued','running')`).groupBy(runs.serviceId);
  const runMap = new Map(activeRuns.map((r) => [r.serviceId, r.n]));
  return c.json(
    rows.map(({ s, account }) => ({
      id: s.id,
      name: s.name,
      merchant_account: account,
      status: s.status,
      active_skill_version_id: s.activeSkillVersionId,
      active_runs: runMap.get(s.id) ?? 0,
      created_at: s.createdAt,
    })),
  );
});

adminRoutes.post("/customer-services/:id/disable", async (c) => {
  const admin = c.get("admin")!;
  await db.update(customerServices).set({ status: "disabled", updatedAt: new Date() }).where(eq(customerServices.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "service.disable", resourceType: "customer_service", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});

adminRoutes.post("/customer-services/:id/enable", async (c) => {
  const admin = c.get("admin")!;
  const [s] = await db.select().from(customerServices).where(eq(customerServices.id, c.req.param("id"))).limit(1);
  if (!s) return c.json({ error: "not_found" }, 404);
  await db.update(customerServices).set({ status: s.activeSkillVersionId ? "ready" : "configuring", updatedAt: new Date() }).where(eq(customerServices.id, s.id));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "service.enable", resourceType: "customer_service", resourceId: s.id });
  return c.json({ ok: true });
});

adminRoutes.post("/customer-services/:id/revoke-keys", async (c) => {
  const admin = c.get("admin")!;
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.serviceId, c.req.param("id")), isNull(apiKeys.revokedAt)));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "service.revoke_keys", resourceType: "customer_service", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});

adminRoutes.delete("/customer-services/:id", async (c) => {
  const admin = c.get("admin")!;
  await db.update(customerServices).set({ status: "deleted", updatedAt: new Date() }).where(eq(customerServices.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "service.delete", resourceType: "customer_service", resourceId: c.req.param("id"), after: { soft_deleted: true } });
  return c.json({ ok: true });
});

// ---------- 邀请码 ----------
adminRoutes.get("/invites", async (c) => {
  const rows = await db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt)).limit(100);
  return c.json(
    rows.map((i) => ({
      id: i.id,
      prefix: i.codePrefix,
      max_uses: i.maxUses,
      used_count: i.usedCount,
      expires_at: i.expiresAt,
      status: i.status,
      created_at: i.createdAt,
    })),
  );
});

adminRoutes.post("/invites", async (c) => {
  const admin = c.get("admin")!;
  const body = InviteUpsertInput.parse(await c.req.json().catch(() => ({})));
  // 生成可读邀请码：HON-XXXXX-XXXXX
  const rand = () => crypto.randomUUID().replaceAll("-", "").slice(0, 5).toUpperCase();
  const code = `HON-${rand()}-${rand()}`;
  const sha = (await import("@honmono/db")).sha256Hex(code);
  const expiresAt = new Date(Date.now() + body.expires_in_days * 24 * 3600 * 1000);
  const [invite] = await db
    .insert(inviteCodes)
    .values({ codeHash: sha, codePrefix: code.slice(0, 8), maxUses: body.max_uses, expiresAt, createdBy: admin.sub })
    .returning();
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "invite.create", resourceType: "invite_code", resourceId: invite.id, after: { prefix: invite.codePrefix, max_uses: body.max_uses } });
  return c.json({ id: invite.id, code, expires_at: invite.expiresAt, max_uses: invite.maxUses });
});

adminRoutes.post("/invites/:id/disable", async (c) => {
  const admin = c.get("admin")!;
  await db.update(inviteCodes).set({ status: "disabled" }).where(eq(inviteCodes.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "invite.disable", resourceType: "invite_code", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});

adminRoutes.get("/invites/:id/redemptions", async (c) => {
  const rows = await db
    .select({ p: purchases, account: merchants.account })
    .from(purchases)
    .leftJoin(merchants, eq(purchases.merchantId, merchants.id))
    .where(eq(purchases.inviteCodeId, c.req.param("id")))
    .orderBy(desc(purchases.redeemedAt));
  return c.json(rows.map((r) => ({ merchant_account: r.account, redeemed_at: r.p.redeemedAt })));
});

// ---------- LLM Providers ----------
adminRoutes.get("/llm/providers", async (c) => {
  const rows = await db.select().from(llmProviders).orderBy(desc(llmProviders.createdAt));
  return c.json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      base_url: p.baseUrl,
      api_key_mask: p.apiKeyMask,
      config_version: p.configVersion,
      status: p.status,
      created_at: p.createdAt,
    })),
  );
});

adminRoutes.post("/llm/providers", async (c) => {
  const admin = c.get("admin")!;
  const body = ProviderUpsertInput.parse(await c.req.json());
  if (!body.api_key) return c.json({ error: "api_key_required", message: "创建 Provider 必须提供 API Key" }, 400);
  const [p] = await db
    .insert(llmProviders)
    .values({
      name: body.name,
      type: body.type,
      baseUrl: body.base_url,
      apiKeyEncrypted: encryptSecret(body.api_key),
      apiKeyMask: maskSecret(body.api_key),
    })
    .returning();
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "llm.provider.create", resourceType: "llm_provider", resourceId: p.id, after: { name: p.name, type: p.type, base_url: p.baseUrl, key_mask: p.apiKeyMask } });
  return c.json({ id: p.id });
});

adminRoutes.patch("/llm/providers/:id", async (c) => {
  const admin = c.get("admin")!;
  const body = ProviderUpsertInput.partial().parse(await c.req.json());
  const [before] = await db.select().from(llmProviders).where(eq(llmProviders.id, c.req.param("id"))).limit(1);
  if (!before) return c.json({ error: "not_found" }, 404);
  const patch: Record<string, unknown> = { updatedAt: new Date(), configVersion: before.configVersion + 1 };
  if (body.name) patch.name = body.name;
  if (body.type) patch.type = body.type;
  if (body.base_url) patch.baseUrl = body.base_url;
  if (body.status) patch.status = body.status;
  if (body.api_key) {
    patch.apiKeyEncrypted = encryptSecret(body.api_key);
    patch.apiKeyMask = maskSecret(body.api_key);
  }
  await db.update(llmProviders).set(patch).where(eq(llmProviders.id, before.id));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "llm.provider.update", resourceType: "llm_provider", resourceId: before.id, before: { name: before.name, base_url: before.baseUrl }, after: patch });
  return c.json({ ok: true });
});

adminRoutes.delete("/llm/providers/:id", async (c) => {
  const admin = c.get("admin")!;
  await db.update(llmProviders).set({ status: "disabled" }).where(eq(llmProviders.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "llm.provider.disable", resourceType: "llm_provider", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});

// ---------- LLM Models ----------
adminRoutes.get("/llm/models", async (c) => {
  const rows = await db
    .select({ m: llmModels, providerName: llmProviders.name })
    .from(llmModels)
    .leftJoin(llmProviders, eq(llmModels.providerId, llmProviders.id))
    .orderBy(desc(llmModels.createdAt));
  return c.json(
    rows.map(({ m, providerName }) => ({
      id: m.id,
      provider_id: m.providerId,
      provider_name: providerName,
      model_key: m.modelKey,
      display_name: m.displayName,
      capabilities: m.capabilities,
      status: m.status,
    })),
  );
});

adminRoutes.post("/llm/models", async (c) => {
  const admin = c.get("admin")!;
  const body = ModelUpsertInput.parse(await c.req.json());
  const [m] = await db
    .insert(llmModels)
    .values({ providerId: body.provider_id, modelKey: body.model_key, displayName: body.display_name, capabilities: body.capabilities })
    .returning();
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "llm.model.create", resourceType: "llm_model", resourceId: m.id, after: { model_key: m.modelKey } });
  return c.json({ id: m.id });
});

adminRoutes.patch("/llm/models/:id", async (c) => {
  const admin = c.get("admin")!;
  const body = ModelUpsertInput.partial().omit({ provider_id: true }).parse(await c.req.json());
  const patch: Record<string, unknown> = {};
  if (body.model_key) patch.modelKey = body.model_key;
  if (body.display_name) patch.displayName = body.display_name;
  if (body.capabilities) patch.capabilities = body.capabilities;
  if (body.status) patch.status = body.status;
  await db.update(llmModels).set(patch).where(eq(llmModels.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "llm.model.update", resourceType: "llm_model", resourceId: c.req.param("id"), after: patch });
  return c.json({ ok: true });
});

adminRoutes.delete("/llm/models/:id", async (c) => {
  const admin = c.get("admin")!;
  await db.update(llmModels).set({ status: "disabled" }).where(eq(llmModels.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "llm.model.disable", resourceType: "llm_model", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});

// ---------- 连接测试 ----------
adminRoutes.post("/llm/models/:id/test", async (c) => {
  const [m] = await db.select().from(llmModels).where(eq(llmModels.id, c.req.param("id"))).limit(1);
  if (!m) return c.json({ error: "not_found" }, 404);
  const [p] = await db.select().from(llmProviders).where(eq(llmProviders.id, m.providerId)).limit(1);
  if (!p) return c.json({ error: "not_found" }, 404);
  try {
    const model = createChatModel({
      providerId: p.id,
      providerType: p.type,
      providerName: p.name,
      baseUrl: p.baseUrl,
      apiKey: decryptSecret(p.apiKeyEncrypted),
      configVersion: p.configVersion,
      modelId: m.id,
      modelKey: m.modelKey,
      displayName: m.displayName,
      capabilities: m.capabilities as never,
    });
    const t0 = Date.now();
    const { HumanMessage } = await import("@langchain/core/messages");
    const res = await (model as unknown as { invoke: (msgs: unknown[]) => Promise<{ content: unknown }> }).invoke([
      new HumanMessage("回复两个字：正常"),
    ]);
    const latency = Date.now() - t0;
    const sampleText = Array.isArray(res.content)
      ? res.content.map((c) => (typeof c === "object" && c && "text" in (c as object) ? String((c as { text: string }).text) : "")).join("")
      : String(res.content);
    await audit({ adminId: c.get("admin")!.sub, adminEmail: c.get("admin")!.email, action: "llm.model.test", resourceType: "llm_model", resourceId: m.id, result: "success" });
    return c.json({ ok: true, latency_ms: latency, sample: sampleText.slice(0, 100) });
  } catch (err) {
    await audit({ adminId: c.get("admin")!.sub, adminEmail: c.get("admin")!.email, action: "llm.model.test", resourceType: "llm_model", resourceId: m.id, result: "failure" });
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
  }
});

// ---------- 场景默认模型 ----------
adminRoutes.get("/llm/defaults/:scenario", async (c) => {
  const scenario = c.req.param("scenario");
  if (!["configuration", "runtime"].includes(scenario)) return c.json({ error: "bad_scenario" }, 400);
  const rows = await db
    .select({ a: modelAssignments, modelKey: llmModels.modelKey, displayName: llmModels.displayName })
    .from(modelAssignments)
    .leftJoin(llmModels, eq(modelAssignments.modelId, llmModels.id))
    .where(and(eq(modelAssignments.scenario, scenario), isNull(modelAssignments.serviceId), eq(modelAssignments.status, "active")))
    .limit(1);
  const row = rows[0];
  return c.json(
    row
      ? { scenario, model_id: row.a.modelId, model_key: row.modelKey, display_name: row.displayName }
      : { scenario, model_id: null },
  );
});

adminRoutes.put("/llm/defaults/:scenario", async (c) => {
  const admin = c.get("admin")!;
  const scenario = c.req.param("scenario");
  if (!["configuration", "runtime"].includes(scenario)) return c.json({ error: "bad_scenario" }, 400);
  const body = AssignmentUpsertInput.pick({ model_id: true }).parse(await c.req.json());
  const before = await db
    .select()
    .from(modelAssignments)
    .where(and(eq(modelAssignments.scenario, scenario), isNull(modelAssignments.serviceId)));
  await db
    .update(modelAssignments)
    .set({ status: "inactive" })
    .where(and(eq(modelAssignments.scenario, scenario), isNull(modelAssignments.serviceId)));
  await db.insert(modelAssignments).values({ scenario, serviceId: null, modelId: body.model_id, updatedBy: admin.email });
  await audit({
    adminId: admin.sub,
    adminEmail: admin.email,
    action: "llm.default.set",
    resourceType: "model_assignment",
    resourceId: scenario,
    before: before.map((b) => ({ model_id: b.modelId, status: b.status })),
    after: { scenario, model_id: body.model_id },
  });
  return c.json({ ok: true });
});

// ---------- 搜索服务（WebSearch / WebFetch 供应商）----------
adminRoutes.get("/search/providers", async (c) => {
  const rows = await db.select().from(searchProviders).orderBy(desc(searchProviders.createdAt));
  return c.json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      api_key_mask: p.apiKeyMask,
      status: p.status,
      quota_remaining: p.quotaRemaining,
      last_status: p.lastStatus,
      last_error: p.lastError,
      last_used_at: p.lastUsedAt,
      last_checked_at: p.lastCheckedAt,
      created_at: p.createdAt,
    })),
  );
});

adminRoutes.post("/search/providers", async (c) => {
  const admin = c.get("admin")!;
  const body = z
    .object({
      name: z.string().min(1).max(64),
      type: z.enum(["brave", "exa"]),
      api_key: z.string().min(1).max(300),
    })
    .parse(await c.req.json());
  const [p] = await db
    .insert(searchProviders)
    .values({
      name: body.name,
      type: body.type,
      apiKeyEncrypted: encryptSecret(body.api_key),
      apiKeyMask: maskSecret(body.api_key),
    })
    .returning();
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "search.provider.create", resourceType: "search_provider", resourceId: p.id, after: { name: p.name, type: p.type, key_mask: p.apiKeyMask } });
  return c.json({ id: p.id });
});

adminRoutes.patch("/search/providers/:id", async (c) => {
  const admin = c.get("admin")!;
  const body = z
    .object({
      name: z.string().min(1).max(64).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      api_key: z.string().min(1).max(300).optional(),
    })
    .parse(await c.req.json());
  const [before] = await db.select().from(searchProviders).where(eq(searchProviders.id, c.req.param("id"))).limit(1);
  if (!before) return c.json({ error: "not_found" }, 404);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name) patch.name = body.name;
  if (body.status) patch.status = body.status;
  if (body.api_key) {
    patch.apiKeyEncrypted = encryptSecret(body.api_key);
    patch.apiKeyMask = maskSecret(body.api_key);
    patch.status = "active";
    patch.lastError = null;
  }
  await db.update(searchProviders).set(patch).where(eq(searchProviders.id, before.id));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "search.provider.update", resourceType: "search_provider", resourceId: before.id, before: { name: before.name, status: before.status }, after: { name: patch.name ?? before.name, status: patch.status ?? before.status } });
  return c.json({ ok: true });
});

adminRoutes.delete("/search/providers/:id", async (c) => {
  const admin = c.get("admin")!;
  await db.update(searchProviders).set({ status: "disabled", updatedAt: new Date() }).where(eq(searchProviders.id, c.req.param("id")));
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "search.provider.disable", resourceType: "search_provider", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});

// 实测：跑一次真实搜索（同时刷新额度状态），并用 webFetch 验证网页读取
adminRoutes.post("/search/providers/:id/test", async (c) => {
  const admin = c.get("admin")!;
  const [p] = await db.select().from(searchProviders).where(eq(searchProviders.id, c.req.param("id"))).limit(1);
  if (!p) return c.json({ error: "not_found" }, 404);
  if (p.status !== "active") return c.json({ ok: false, error: "供应商已停用" }, 200);
  const info: SearchProviderInfo = { id: p.id, name: p.name, type: p.type as "brave" | "exa", apiKey: decryptSecret(p.apiKeyEncrypted) };
  const router = new SearchRouter([info], {
    persist: (pid, patch) => {
      const { lastUsedAt, ...rest } = patch;
      db.update(searchProviders).set({ ...rest, ...(lastUsedAt ? { lastUsedAt } : {}), lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(searchProviders.id, pid)).catch(() => {});
    },
  });
  const t0 = Date.now();
  const r = await router.search("王者荣耀 官网", 3);
  const latency = Date.now() - t0;
  const [after] = await db.select().from(searchProviders).where(eq(searchProviders.id, p.id)).limit(1);
  if (!r) {
    await audit({ adminId: admin.sub, adminEmail: admin.email, action: "search.provider.test", resourceType: "search_provider", resourceId: p.id, result: "failure" });
    return c.json({ ok: false, error: after?.lastError ?? "搜索失败", latency_ms: latency }, 200);
  }
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "search.provider.test", resourceType: "search_provider", resourceId: p.id, result: "success" });
  return c.json({ ok: true, provider: r.provider, results: r.results.length, latency_ms: latency, quota_remaining: after?.quotaRemaining ?? null, sample: r.results.slice(0, 2).map((x) => x.url) }, 200);
});

// WebFetch 连通性测试
adminRoutes.post("/search/fetch-test", async (c) => {
  const admin = c.get("admin")!;
  const body = z.object({ url: z.string().url() }).parse(await c.req.json());
  try {
    const page = await webFetch(body.url, 1200);
    await audit({ adminId: admin.sub, adminEmail: admin.email, action: "search.fetch_test", resourceType: "search_provider", resourceId: body.url, result: "success" });
    return c.json({ ok: true, title: page.title, chars: page.text.length, sample: page.text.slice(0, 160) });
  } catch (err) {
    await audit({ adminId: admin.sub, adminEmail: admin.email, action: "search.fetch_test", resourceType: "search_provider", resourceId: body.url, result: "failure" });
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
  }
});

// ---------- 平台设置 ----------
adminRoutes.get("/settings", async (c) => {
  return c.json(await getAllSettings());
});

adminRoutes.put("/settings", async (c) => {
  const admin = c.get("admin")!;
  const body = SettingsUpdateInput.parse(await c.req.json());
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) await setSetting(k, v, admin.email);
  }
  await audit({ adminId: admin.sub, adminEmail: admin.email, action: "settings.update", resourceType: "platform_settings", after: body });
  return c.json({ ok: true });
});

// ---------- 审计日志 ----------
adminRoutes.get("/audit-logs", async (c) => {
  const rows = await db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt)).limit(200);
  return c.json(
    rows.map((r) => ({
      id: r.id,
      admin_email: r.adminEmail,
      action: r.action,
      resource_type: r.resourceType,
      resource_id: r.resourceId,
      result: r.result,
      created_at: r.createdAt,
      before: r.beforeJson,
      after: r.afterJson,
    })),
  );
});
