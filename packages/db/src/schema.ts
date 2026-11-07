import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  account: text("account").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("active"), // active | disabled | deleted
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  codePrefix: text("code_prefix").notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("active"), // active | disabled
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id").notNull(),
  inviteCodeId: uuid("invite_code_id").notNull(),
  plan: text("plan").notNull().default("standard"),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerServices = pgTable(
  "customer_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("configuring"), // configuring | ready | disabled | deleted
    activeSkillVersionId: uuid("active_skill_version_id"),
    draftSkillVersionId: uuid("draft_skill_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cs_merchant_idx").on(t.merchantId)],
);

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind").notNull(), // draft | published
    rootPath: text("root_path").notNull(),
    readinessJson: jsonb("readiness_json"),
    manifestJson: jsonb("manifest_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("sv_service_idx").on(t.serviceId, t.version)],
);

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull(),
  draftVersionId: uuid("draft_version_id"),
  originalName: text("original_name").notNull(),
  storedPath: text("stored_path").notNull(),
  textPath: text("text_path"),
  mime: text("mime"),
  size: bigint("size", { mode: "number" }).notNull(),
  sha256: text("sha256"),
  parseStatus: text("parse_status").notNull().default("pending"), // pending | parsing | parsed | failed | unsupported
  parseReport: jsonb("parse_report"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id").notNull(),
    externalId: text("external_id"),
    channel: text("channel").notNull(), // production | test | config
    controlState: text("control_state").notNull().default("ai"), // ai | pending_human | human_controlled
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conv_uniq").on(t.serviceId, t.channel, t.externalId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    role: text("role").notNull(), // user | assistant | system
    authorType: text("author_type").notNull(), // end_user | ai | human | merchant | system
    content: text("content").notNull(),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("msg_conv_idx").on(t.conversationId, t.id)],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: text("request_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    kind: text("kind").notNull(), // production | test | configuration
    state: text("state").notNull().default("queued"),
    queueReason: text("queue_reason"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    resultJson: jsonb("result_json"),
    pendingText: text("pending_text"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    skillVersionId: uuid("skill_version_id"),
    modelKey: text("model_key"),
    providerConfigVersion: integer("provider_config_version"),
    capabilitiesSnapshot: jsonb("capabilities_snapshot"),
    traceId: text("trace_id"),
    inputSummary: text("input_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("runs_request_uq").on(t.serviceId, t.requestId),
    index("runs_conv_state_idx").on(t.conversationId, t.state),
  ],
);

export const handoffs = pgTable("handoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  runId: uuid("run_id"),
  reason: text("reason").notNull(),
  question: text("question").notNull(),
  contextSummary: text("context_summary"),
  suggestedReplies: jsonb("suggested_replies"),
  state: text("state").notNull().default("pending"), // pending | assisted_reply | human_controlled | resolved
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const llmProviders = pgTable("llm_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(), // anthropic | openai_compatible
  baseUrl: text("base_url").notNull(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  apiKeyMask: text("api_key_mask").notNull(),
  configVersion: integer("config_version").notNull().default(1),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmModels = pgTable("llm_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerId: uuid("provider_id").notNull(),
  modelKey: text("model_key").notNull(),
  displayName: text("display_name").notNull(),
  capabilities: jsonb("capabilities").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modelAssignments = pgTable("model_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  scenario: text("scenario").notNull(), // configuration | runtime
  serviceId: uuid("service_id"), // null = 平台默认
  modelId: uuid("model_id").notNull(),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("active"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const searchProviders = pgTable("search_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(), // brave | exa
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  apiKeyMask: text("api_key_mask").notNull(),
  status: text("status").notNull().default("active"), // active | disabled
  priority: integer("priority").notNull().default(0),
  quotaRemaining: integer("quota_remaining"),
  lastStatus: text("last_status"), // ok | rate_limited | exhausted | error
  lastError: text("last_error"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id"),
  adminEmail: text("admin_email"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  requestId: text("request_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  result: text("result").notNull().default("success"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 关系（便于 drizzle 查询 API 使用）
export const customerServicesRelations = relations(customerServices, ({ one }) => ({
  merchant: one(merchants, { fields: [customerServices.merchantId], references: [merchants.id] }),
}));

export type Merchant = typeof merchants.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type CustomerService = typeof customerServices.$inferSelect;
export type SkillVersion = typeof skillVersions.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Handoff = typeof handoffs.$inferSelect;
export type LlmProvider = typeof llmProviders.$inferSelect;
export type LlmModel = typeof llmModels.$inferSelect;
export type ModelAssignment = typeof modelAssignments.$inferSelect;
export type SearchProvider = typeof searchProviders.$inferSelect;
