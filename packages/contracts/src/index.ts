import { z } from "zod";

// ============ 通用 ============
export const RunState = z.enum([
  "queued",
  "running",
  "waiting_input",
  "waiting_human",
  "succeeded",
  "superseded",
  "interrupted",
  "failed",
]);
export type RunState = z.infer<typeof RunState>;

export const ConversationChannel = z.enum(["production", "test", "config"]);
export type ConversationChannel = z.infer<typeof ConversationChannel>;

export const ControlState = z.enum(["ai", "pending_human", "human_controlled"]);
export type ControlState = z.infer<typeof ControlState>;

export const ServiceStatus = z.enum(["configuring", "ready", "disabled", "deleted"]);
export type ServiceStatus = z.infer<typeof ServiceStatus>;

// ============ 认证 ============
export const RegisterInput = z.object({
  account: z.string().min(3).max(64).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$|^[a-zA-Z0-9_-]{3,32}$/, "账号需为邮箱或 3-32 位字母数字"),
  password: z.string().min(8).max(72),
});
export const LoginInput = z.object({
  account: z.string().min(1),
  password: z.string().min(1),
});
export const RedeemInput = z.object({ code: z.string().min(6).max(64) });

// ============ 客服 ============
export const CreateServiceInput = z.object({ name: z.string().min(1).max(64).optional() });

export const ConfigMessageInput = z.object({ content: z.string().min(1).max(8000) });

// ============ 公开 Chat API ============
export const ChatMessageIn = z.object({
  role: z.literal("user"),
  content: z.string().min(1).max(8000),
});
export const ChatInput = z.object({
  request_id: z.string().uuid(),
  conversation_id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_:-]+$/, "conversation_id 仅允许字母数字与 _:-"),
  messages: z.array(ChatMessageIn).min(1).max(10),
  metadata: z.object({ end_user_id: z.string().max(128).optional() }).optional(),
});

// ============ 测试台 ============
export const TestRunInput = z.object({
  content: z.string().min(1).max(8000),
  use_draft: z.boolean().default(true),
  reset: z.boolean().default(false),
});

// ============ 人工接管 ============
export const HandoffReplyInput = z.object({ text: z.string().min(1).max(8000) });

// ============ LLM 配置 ============
export const ProviderType = z.enum(["anthropic", "openai_compatible"]);
export const ProviderUpsertInput = z.object({
  name: z.string().min(1).max(64),
  type: ProviderType,
  base_url: z.string().url().max(300),
  api_key: z.string().min(1).max(300).optional(), // 创建必填；编辑留空表示不变
  status: z.enum(["active", "disabled"]).default("active"),
});
export const ModelUpsertInput = z.object({
  provider_id: z.string().uuid(),
  model_key: z.string().min(1).max(120),
  display_name: z.string().min(1).max(120),
  capabilities: z
    .object({
      tool_call: z.boolean().default(true),
      vision: z.boolean().default(false),
      json: z.boolean().default(true),
      reasoning_summary: z.boolean().default(false),
    })
    .default({ tool_call: true, vision: false, json: true, reasoning_summary: false }),
  status: z.enum(["active", "disabled"]).default("active"),
});
export const AssignmentUpsertInput = z.object({
  scenario: z.enum(["configuration", "runtime"]),
  model_id: z.string().uuid(),
});
export const TestConnectionInput = z.object({
  provider_id: z.string().uuid().optional(),
  model_id: z.string().uuid().optional(),
});

// ============ 管理员 ============
export const InviteUpsertInput = z.object({
  max_uses: z.number().int().min(1).max(10000).default(1),
  expires_in_days: z.number().int().min(1).max(3650).default(365),
});
export const AdminPasswordResetInput = z.object({ new_password: z.string().min(8).max(72) });
export const SettingsUpdateInput = z.object({
  queue_full_limit: z.number().int().min(1).max(1000).optional(),
  chat_run_timeout_seconds: z.number().int().min(30).max(600).optional(),
  max_file_mb: z.number().int().min(1).max(100).optional(),
  max_files_per_service: z.number().int().min(1).max(200).optional(),
});

// ============ API Key ============
export const ApiKeyCreateInput = z.object({ name: z.string().min(1).max(64) });

// ============ Chat 响应（共享形状） ============
export type ChatCompleted = {
  request_id: string;
  conversation_id: string;
  status: "completed";
  message: { role: "assistant"; content: string };
  run: { skill_version: number | null; trace_id: string | null; started_at: string | null; finished_at: string | null };
};
export type ChatWaitingHuman = {
  request_id: string;
  conversation_id: string;
  status: "waiting_for_human";
  handoff_id: string;
  run: { trace_id: string | null };
};
export type ChatHumanControlled = {
  request_id: string;
  conversation_id: string;
  status: "human_controlled";
};
export type ChatSuperseded = {
  request_id: string;
  conversation_id: string;
  status: "superseded";
  superseded_by: string;
};
export type ChatTerminal =
  | ChatCompleted
  | ChatWaitingHuman
  | ChatHumanControlled
  | ChatSuperseded;
