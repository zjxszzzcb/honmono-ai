import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.APP_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/honmono",
  },
});
