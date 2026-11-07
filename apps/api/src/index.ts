import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { verifySession, SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "./auth.js";
import { API_PORT, type AppEnv } from "./env.js";
import { authRoutes, adminAuthRoutes, activationRoutes } from "./routes/auth.js";
import { serviceRoutes } from "./routes/services.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";
import { merchantRoutes } from "./routes/merchant.js";
import { ensureDirs } from "./boot.js";
import { setupGlobalProxy, setupLangfuseOtel } from "@honmono/agent";

const app = new Hono<AppEnv>();

app.use(logger());
app.use(
  "/api/*",
  cors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:5173", "http://localhost:8080"],
    credentials: true,
  }),
);
app.use("/v1/*", cors({ origin: "*" }));

// 会话解析
app.use("/api/*", async (c, next) => {
  const merchant = verifySession(getCookie(c, SESSION_COOKIE));
  const admin = verifySession(getCookie(c, ADMIN_SESSION_COOKIE));
  c.set("merchant", merchant && merchant.typ === "merchant" ? { sub: merchant.sub } : null);
  c.set("admin", admin && admin.typ === "admin" ? { sub: admin.sub, email: "" } : null);
  await next();
});
// admin email 填充（审计用）
app.use("/api/admin/*", async (c, next) => {
  const admin = c.get("admin");
  if (admin && !admin.email) {
    const { db, adminUsers } = await import("@honmono/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.sub)).limit(1);
    if (row) c.set("admin", { sub: admin.sub, email: row.email });
  }
  await next();
});

app.get("/healthz", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/activation", activationRoutes);
app.route("/api/admin/auth", adminAuthRoutes);
// 管理员业务路由挂载在 /api/admin（内部路由已含 /users 等路径）
app.route("/api/admin", adminRoutes);
app.route("/api/customer-services", serviceRoutes);
app.route("/api", merchantRoutes);
app.route("/v1", publicRoutes);

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  const status = err.name === "ZodError" ? 400 : 500;
  if (status === 500) console.error("[api:error]", err);
  return c.json({ error: err.name, message }, status as 400 | 500);
});

await setupGlobalProxy();
await setupLangfuseOtel();
await ensureDirs();

serve({ fetch: app.fetch, port: API_PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});
