import { and, desc, eq, sql, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { apiKeys, customerServices, db, handoffs } from "@honmono/db";
import type { AppEnv } from "../env.js";

/** 商户级跨客服视图：转人工工单与 API Key 汇总 */
export const merchantRoutes = new Hono<AppEnv>();

merchantRoutes.use("*", async (c, next) => {
  if (!c.get("merchant")) return c.json({ error: "unauthorized" }, 401);
  await next();
});

// 跨客服的人工接管工单
merchantRoutes.get("/handoffs", async (c) => {
  const merchantId = c.get("merchant")!.sub;
  const rows = await db
    .select({ h: handoffs, serviceName: customerServices.name, serviceStatus: customerServices.status })
    .from(handoffs)
    .innerJoin(customerServices, eq(handoffs.serviceId, customerServices.id))
    .where(and(eq(customerServices.merchantId, merchantId), sql`${customerServices.status} != 'deleted'`))
    .orderBy(desc(handoffs.createdAt))
    .limit(100);
  const { listMessages } = await import("@honmono/db");
  const out = [];
  for (const r of rows) {
    const msgs = await listMessages(r.h.conversationId, 0, 30);
    out.push({
      id: r.h.id,
      service_id: r.h.serviceId,
      service_name: r.serviceName,
      state: r.h.state,
      reason: r.h.reason,
      question: r.h.question,
      context_summary: r.h.contextSummary,
      suggested_replies: r.h.suggestedReplies,
      conversation_control_state: null,
      created_at: r.h.createdAt,
      resolved_at: r.h.resolvedAt,
      messages: msgs.map((m) => ({ id: Number(m.id), role: m.role, author_type: m.authorType, content: m.content, created_at: m.createdAt })),
    });
  }
  return c.json(out);
});

// 跨客服的 API Key（含所属客服）
merchantRoutes.get("/api-keys", async (c) => {
  const merchantId = c.get("merchant")!.sub;
  const rows = await db
    .select({ k: apiKeys, serviceId: customerServices.id, serviceName: customerServices.name, serviceStatus: customerServices.status })
    .from(apiKeys)
    .innerJoin(customerServices, eq(apiKeys.serviceId, customerServices.id))
    .where(and(eq(customerServices.merchantId, merchantId), sql`${customerServices.status} != 'deleted'`))
    .orderBy(desc(apiKeys.createdAt));
  return c.json(
    rows.map(({ k, serviceId, serviceName, serviceStatus }) => ({
      id: k.id,
      service_id: serviceId,
      service_name: serviceName,
      service_status: serviceStatus,
      name: k.name,
      prefix: k.prefix,
      revoked: Boolean(k.revokedAt),
      last_used_at: k.lastUsedAt,
      created_at: k.createdAt,
    })),
  );
});

export const _null = isNull;
