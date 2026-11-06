import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { hash } from "@node-rs/argon2";
import { adminUsers } from "./schema.js";
import { setSetting } from "./services.js";

export async function runMigrationsAndSeed() {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL 未配置");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.log("[migrate] applying migrations...");
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log("[migrate] done");

  // 幂等创建初始管理员（仅当不存在任何管理员时）
  const existing = await db.select().from(adminUsers).limit(1);
  if (!existing[0]) {
    const email = process.env.ADMIN_INITIAL_EMAIL;
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (email && password) {
      const passwordHash = await hash(password);
      await db.insert(adminUsers).values({ email, passwordHash });
      console.log(`[seed] initial admin created: ${email}`);
    } else {
      console.log("[seed] ADMIN_INITIAL_EMAIL/PASSWORD 未配置，跳过初始管理员创建");
    }
  } else {
    console.log("[seed] admin exists, skip");
  }

  // 默认平台参数
  await setSetting("queue_full_limit", 20);
  await setSetting("chat_run_timeout_seconds", 180);
  await setSetting("max_file_mb", 20);
  await setSetting("max_files_per_service", 50);

  await client.end();
}

// 直接执行入口
if (process.argv[1] && process.argv[1].endsWith("run-migrate.ts")) {
  runMigrationsAndSeed()
    .then(() => {
      console.log("[migrate] all done");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[migrate] FAILED:", err);
      process.exit(1);
    });
}
