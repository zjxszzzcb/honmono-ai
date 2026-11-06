import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.APP_DATABASE_URL;
if (!url) throw new Error("APP_DATABASE_URL 未配置");

// 迁移与运行共用连接；max 控制池大小
export const pgClient = postgres(url, { max: 10, idle_timeout: 30 });
export const db = drizzle(pgClient, { schema });
export * as tables from "./schema.js";
