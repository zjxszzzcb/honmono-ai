import { tool } from "@langchain/core/tools";
import { z } from "zod";

export type AgentEvent =
  | { type: "tool.started"; name: string; summary: string }
  | { type: "tool.finished"; name: string; ok: boolean };

export type AskUserQuestion = { question: string; options: string[] };

export type ResponseOutcome =
  | { kind: "response"; text: string; sleepSeconds: number; degraded?: boolean }
  | { kind: "ask_human"; reason: string; question: string; contextSummary: string; suggestedReplies: string[] }
  | { kind: "ask_user"; intro: string; questions: AskUserQuestion[] };

export type Signal = { outcome: ResponseOutcome | null };

/**
 * 构造 response / ask_human 工具。信号写入共享 Signal 对象；
 * 每次 Run 最多生效一次：已生效后再次调用返回错误提示。
 */
export function createSignalTools(signal: Signal, onEvent?: (e: AgentEvent) => void) {
  const responseTool = tool(
    async ({ text, sleep }) => {
      if (signal.outcome) {
        return "错误：本次运行已生成过回复，不能再调用 response。";
      }
      if (text.trim().length === 0) {
        return "错误：text 不能为空字符串。";
      }
      if (sleep !== undefined && sleep !== 0 && !(sleep >= 2 && sleep <= 30)) {
        return "错误：sleep 只允许 0 或 2-30 的整数秒。";
      }
      onEvent?.({ type: "tool.started", name: "response", summary: sleep ? `回复并等待 ${sleep}s` : "发送回复" });
      signal.outcome = { kind: "response", text: text.trim(), sleepSeconds: sleep ?? 0 };
      onEvent?.({ type: "tool.finished", name: "response", ok: true });
      return "ok：回复已被接受，本次运行结束。不要再调用任何工具。";
    },
    {
      name: "response",
      description:
        "向客户发送最终回复并结束本次运行。每次运行必须且只能调用一次。参数 text 为要发送的完整文本；sleep 为可选的等待秒数（0 或 2-30），用于给客户留出补充消息的时间，到期后 text 才会发出。",
      schema: z.object({
        text: z.string().min(1).describe("要发送给客户的完整文本"),
        sleep: z.number().int().optional().describe("可选等待秒数，只允许 0 或 2-30"),
      }),
    },
  );

  const askHumanTool = tool(
    async ({ reason, question, context_summary, suggested_replies }) => {
      if (signal.outcome) {
        return "错误：本次运行已生成过回复或求助，不能再调用 ask_human。";
      }
      onEvent?.({ type: "tool.started", name: "ask_human", summary: reason.slice(0, 60) });
      signal.outcome = {
        kind: "ask_human",
        reason: reason.trim(),
        question: question.trim(),
        contextSummary: context_summary.trim(),
        suggestedReplies: (suggested_replies ?? []).slice(0, 3).map((s) => s.trim()).filter(Boolean),
      };
      onEvent?.({ type: "tool.finished", name: "ask_human", ok: true });
      return "ok：求助已创建，会话已转人工。本次运行结束。";
    },
    {
      name: "ask_human",
      description:
        "当遇到无法基于已有资料回答的问题、需要商户决策或客户明确要求人工时，创建人工求助并暂停 AI。不要编造答案。",
      schema: z.object({
        reason: z.string().min(1).max(300).describe("为什么需要人工，简短可审计"),
        question: z.string().min(1).max(1000).describe("需要人工判断或回答的问题"),
        context_summary: z.string().min(1).max(2000).describe("给商户看的上下文摘要"),
        suggested_replies: z.array(z.string().min(1).max(1000)).max(3).optional().describe("0-3 条建议回复"),
      }),
    },
  );

  const askUserTool = tool(
    async ({ intro, questions }) => {
      if (signal.outcome) {
        return "错误：本次运行已生成过回复或求助，不能再调用 ask_user。";
      }
      const cleaned = questions
        .map((q) => ({ question: q.question.trim(), options: q.options.map((o) => o.trim()).filter(Boolean).slice(0, 6) }))
        .filter((q) => q.question && q.options.length >= 2)
        .slice(0, 3);
      if (cleaned.length === 0) {
        return "错误：ask_user 至少需要 1 个问题且每题 2 个以上选项；描述类问题请不要用本工具。";
      }
      onEvent?.({ type: "tool.started", name: "ask_user", summary: `${cleaned.length} 个选择题` });
      signal.outcome = { kind: "ask_user", intro: intro.trim(), questions: cleaned };
      onEvent?.({ type: "tool.finished", name: "ask_user", ok: true });
      return "ok：选择题已提交给用户，本次运行结束，等待用户点选回答。";
    },
    {
      name: "ask_user",
      description:
        "向用户提出选择题（面向结构化确认）。仅当问题可以归纳为明确的选项时使用（如：业务类别、目标用户、套餐模式）。每次 1-3 题，每题 2-6 个选项；开放式/描述类问题直接写在 response 里问，不要用本工具。",
      schema: z.object({
        intro: z.string().min(1).max(300).describe("一句话说明为什么问这些"),
        questions: z
          .array(
            z.object({
              question: z.string().min(1).max(200).describe("问题本身"),
              options: z.array(z.string().min(1).max(120)).min(2).max(6).describe("候选项"),
            }),
          )
          .min(1)
          .max(3),
      }),
    },
  );

  return { responseTool, askHumanTool, askUserTool };
}

/**
 * 配置 Agent 专用的服务端能力工具：validate / publish。
 * 服务端把确定性实现通过回调注入，Agent 无法传任意命令。
 */
export function createConfigCapabilityTools(input: {
  onValidate: () => Promise<{ ok: boolean; readiness: unknown; blockers: string[] }>;
  onPublish: () => Promise<{ ok: boolean; version?: number; message: string }>;
  onEvent?: (e: AgentEvent) => void;
}) {
  const validateTool = tool(
    async () => {
      input.onEvent?.({ type: "tool.started", name: "validate_skill", summary: "校验草稿 Skill" });
      const res = await input.onValidate();
      input.onEvent?.({ type: "tool.finished", name: "validate_skill", ok: res.ok });
      return JSON.stringify(res);
    },
    {
      name: "validate_skill",
      description: "对当前草稿 Skill 执行确定性校验，返回 readiness 状态与未满足条件列表。",
      schema: z.object({}),
    },
  );

  const publishTool = tool(
    async () => {
      input.onEvent?.({ type: "tool.started", name: "publish_skill", summary: "发布新版本" });
      const res = await input.onPublish();
      input.onEvent?.({ type: "tool.finished", name: "publish_skill", ok: res.ok });
      return JSON.stringify(res);
    },
    {
      name: "publish_skill",
      description: "校验通过后发布当前草稿为新的不可变版本并切换 active。校验不通过会返回失败原因。",
      schema: z.object({}),
    },
  );

  return { validateTool, publishTool };
}
