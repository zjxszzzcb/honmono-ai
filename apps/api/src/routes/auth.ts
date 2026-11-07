import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { hash, verify } from "@node-rs/argon2";
import { db, merchants, inviteCodes, purchases, adminUsers, customerServices, skillVersions, conversations } from "@honmono/db";
import { appendMessage, getOrCreateConversation } from "@honmono/db";
import {
  LoginInput,
  RegisterInput,
  RedeemInput,
} from "@honmono/contracts";
import { newSession, SESSION_COOKIE, ADMIN_SESSION_COOKIE, verifySession } from "../auth.js";
import type { AppEnv } from "../env.js";

export const authRoutes = new Hono<AppEnv>();
export const adminAuthRoutes = new Hono<AppEnv>();

// ---------- 商户注册 / 登录 / 登出 ----------
authRoutes.post("/register", async (c) => {
  const body = RegisterInput.parse(await c.req.json());
  const existing = await db.select().from(merchants).where(eq(merchants.account, body.account)).limit(1);
  if (existing[0]) return c.json({ error: "account_exists", message: "该账号已注册" }, 409);
  const passwordHash = await hash(body.password);
  const [merchant] = await db
    .insert(merchants)
    .values({ account: body.account, passwordHash })
    .returning();
  const { token, maxAge } = newSession(merchant.id, "merchant");
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge });
  return c.json({ id: merchant.id, account: merchant.account, activated: false });
});

authRoutes.post("/login", async (c) => {
  const body = LoginInput.parse(await c.req.json());
  const [merchant] = await db.select().from(merchants).where(eq(merchants.account, body.account)).limit(1);
  if (!merchant || merchant.status !== "active") {
    return c.json({ error: "invalid_credentials", message: "账号或密码错误，或账号已停用" }, 401);
  }
  const ok = await verify(merchant.passwordHash, body.password).catch(() => false);
  if (!ok) return c.json({ error: "invalid_credentials", message: "账号或密码错误" }, 401);
  await db.update(merchants).set({ lastLoginAt: new Date() }).where(eq(merchants.id, merchant.id));
  const { token, maxAge } = newSession(merchant.id, "merchant");
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge });
  return c.json({ id: merchant.id, account: merchant.account });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const m = c.get("merchant");
  if (!m) return c.json({ error: "unauthorized" }, 401);
  const [row] = await db.select().from(merchants).where(eq(merchants.id, m.sub)).limit(1);
  if (!row || row.status !== "active") return c.json({ error: "merchant_disabled" }, 401);
  const activated = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(purchases)
    .where(eq(purchases.merchantId, row.id));
  return c.json({ id: row.id, account: row.account, activated: (activated[0]?.n ?? 0) > 0 });
});

// ---------- 邀请码激活（挂载于 /api/activation）----------
export const activationRoutes = new Hono<AppEnv>();
activationRoutes.use("*", async (c, next) => {
  if (!c.get("merchant")) return c.json({ error: "unauthorized" }, 401);
  await next();
});
activationRoutes.post("/redeem", async (c) => {
  const m = c.get("merchant");
  if (!m) return c.json({ error: "unauthorized" }, 401);
  const body = RedeemInput.parse(await c.req.json());
  const codeHash = (await import("@honmono/db")).sha256Hex(body.code.trim().toUpperCase());

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(inviteCodes).where(eq(inviteCodes.codeHash, codeHash)).limit(1);
    if (!invite) return { ok: false as const, status: 404 as const, message: "邀请码不存在" };
    if (invite.status !== "active") return { ok: false as const, status: 409 as const, message: "邀请码已停用" };
    if (invite.expiresAt.getTime() < Date.now()) return { ok: false as const, status: 409 as const, message: "邀请码已过期" };
    if (invite.usedCount >= invite.maxUses) return { ok: false as const, status: 409 as const, message: "邀请码已被用完" };
    const already = await tx.select().from(purchases).where(eq(purchases.merchantId, m.sub)).limit(1);
    if (already[0]) return { ok: false as const, status: 409 as const, message: "该账号已激活过权益" };
    const updated = await tx
      .update(inviteCodes)
      .set({ usedCount: invite.usedCount + 1 })
      .where(and(eq(inviteCodes.id, invite.id), sql`${inviteCodes.usedCount} < ${inviteCodes.maxUses}`))
      .returning();
    if (!updated[0]) return { ok: false as const, status: 409 as const, message: "邀请码已被用完" };
    await tx.insert(purchases).values({ merchantId: m.sub, inviteCodeId: invite.id });
    return { ok: true as const };
  });

  if (!result.ok) return c.json({ error: "redeem_failed", message: result.message }, result.status satisfies 404 | 409);
  return c.json({ ok: true, message: "激活成功" });
});

// ---------- 管理员登录 ----------
adminAuthRoutes.post("/login", async (c) => {
  const body = LoginInput.parse(await c.req.json());
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, body.account)).limit(1);
  if (!admin || admin.status !== "active") return c.json({ error: "invalid_credentials", message: "邮箱或密码错误" }, 401);
  const ok = await verify(admin.passwordHash, body.password).catch(() => false);
  if (!ok) return c.json({ error: "invalid_credentials", message: "邮箱或密码错误" }, 401);
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, admin.id));
  const { token, maxAge } = newSession(admin.id, "admin");
  setCookie(c, ADMIN_SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge });
  return c.json({ id: admin.id, email: admin.email });
});

adminAuthRoutes.post("/logout", (c) => {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

adminAuthRoutes.get("/me", async (c) => {
  const a = verifySession(getCookie(c, ADMIN_SESSION_COOKIE));
  if (!a || a.typ !== "admin") return c.json({ error: "unauthorized" }, 401);
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, a.sub)).limit(1);
  if (!row || row.status !== "active") return c.json({ error: "unauthorized" }, 401);
  return c.json({ id: row.id, email: row.email });
});
