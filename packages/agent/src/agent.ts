import { AIMessage, HumanMessage, type BaseMessageLike } from "@langchain/core/messages";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createDeepAgent, createFilesystemMiddleware, FilesystemBackend } from "deepagents";
import { createMiddleware } from "langchain";
import { createSignalTools, createConfigCapabilityTools, type AgentEvent, type ResponseOutcome } from "./tools.js";
import { WEB_TOOL_RULES } from "./websearch.js";
import { ensureHarnessProfile, RESPONSE_NUDGE } from "./langfuse.js";

export type { AgentEvent, ResponseOutcome };

export type ChatTurn = { role: "user" | "assistant"; content: string };

export class RunInterruptedError extends Error {
  constructor(message = "已根据用户的新输入中断") {
    super(message);
    this.name = "RunInterruptedError";
  }
}

/** 打断面：每次模型调用 / 工具调用后检查；命中即抛出，放弃本次运行 */
function createInterruptMiddleware(checkInterrupt?: () => Promise<boolean>) {
  if (!checkInterrupt) return null;
  return createMiddleware({
    name: "HonmonoInterrupt",
    wrapModelCall: async (req, next) => {
      if (await checkInterrupt()) throw new RunInterruptedError();
      return next(req);
    },
    wrapToolCall: async (req, next) => {
      const res = await next(req);
      if (await checkInterrupt()) throw new RunInterruptedError();
      return res;
    },
  });
}

const RUNTIME_STYLE_RULES = `
## 回复风格（必须遵守）
- 用自然、口语化的中文和用户聊天，像真人客服：可以用"～"、"呢"、"哈"等语气词，但不要堆砌。
- 一次只回答用户问的事；不要每句话都列表化。只有内容确实是并列步骤时才用短列表。
- 不要自称"AI 助手/语言模型"，不要说"根据我的知识库/根据系统设定"。就直接以客服身份说话。
- 回复长度跟着问题走：简单问题两三句话答完，不灌输用户没问的信息。
- 资料里没有的事实不要编造；不确定就明确说"这个我帮您确认一下"，并调用 ask_human。
- 用户情绪激动时先安抚再处理问题。

## 工具使用
- 可以用 ls / read_file / glob / grep 查看客服知识文件（路径相对根目录，如 references/policies.md）。
- 需要查资料再回答时，先查再答；禁止假装查过。
- 最终回复必须调用 response 工具发出；调用 response 后本次运行结束。
- 无法回答、需要商户决策、涉及投诉升级时调用 ask_human，不要硬编答案。
`;

export function composeRuntimeSystemPrompt(skillMarkdown: string): string {
  return `${skillMarkdown.trim()}\n${RUNTIME_STYLE_RULES}`;
}

const CONFIG_STYLE_RULES = `
## 输出契约（必须遵守）
- 每轮以调用 response 工具结束，text 是给商户看的配置进展与下一个最重要的问题。
- 每轮最多问 1-2 个问题；不要重复询问已回答或已从文件中确认的信息。
- 商户拒绝或不知道时，标记 unknown 继续推进，不纠缠。
- 达到最低就绪条件时先调用 validate_skill，通过后调用 publish_skill，再用 response 告知商户客服已可用。
- 所有写入仅限当前草稿目录；不得编造商户没有提供的事实，未知项明确写 unknown。
- 语气自然友好，像一位帮忙搭客服的产品顾问，不要用问卷腔。

## 自主研究（重要）
- 商户提供了可自查的线索（官网、产品名、公司名）时，主动用 web_search / web_fetch 自行取证，不要什么都等商户喂。
- 自主研究结论写入 references/research-notes.md：每条注明来源 URL、抓取时间、置信度（高/中/低）；与商户口述冲突时以商户为准并在回复中指出。
- 尚不能确认、需要商户拍板的事项记入 references/open-questions.md（待人工二次确认清单），逐条带背景与建议默认值。
- 商户的新输入到达时会中断你的当前工作并由新一轮接手：保持每轮写入原子、完整，随时可被打断。

## 提问方式
- 可以归纳为明确选项的问题（类别、模式、受众等）用 ask_user 工具发出（每次 1-3 题，每题 2-6 个选项，选项要互斥且具体）。
- 开放式、需要描述的问题直接写在 response 的 text 里问。
- 两者不要在同一轮重复问同一件事；优先 ask_user，能减少商户打字负担。
`;

export type RuntimeAgentDeps = {
  model: BaseLanguageModel;
  modelKey: string;
  skillRootDir: string;
  skillMarkdown: string;
  chatMessages: ChatTurn[];
  onEvent?: (e: AgentEvent) => void;
  callbacks?: Callbacks;
  recursionLimit?: number;
  /** 额外工具（如 web_search / web_fetch）；提供时会自动附加联网使用规范 */
  extraTools?: import("@langchain/core/tools").StructuredToolInterface[];
  /** 返回 true 表示用户已发来新输入，应立即中断本次运行 */
  checkInterrupt?: () => Promise<boolean>;
};

/** 运行时 Agent：只读文件工具 + response + ask_human */
export async function runRuntimeAgent(deps: RuntimeAgentDeps): Promise<ResponseOutcome> {
  ensureHarnessProfile(deps.modelKey);
  const signal = { outcome: null as ResponseOutcome | null };
  const { responseTool, askHumanTool } = createSignalTools(signal, deps.onEvent);
  const backend = new FilesystemBackend({ rootDir: deps.skillRootDir, virtualMode: true });
  const interruptMw = createInterruptMiddleware(deps.checkInterrupt);
  const agent = createDeepAgent({
    model: deps.model,
    systemPrompt: composeRuntimeSystemPrompt(deps.skillMarkdown) + (deps.extraTools?.length ? WEB_TOOL_RULES : ""),
    backend,
    tools: deps.extraTools?.length ? [responseTool, askHumanTool, ...deps.extraTools] : [responseTool, askHumanTool],
    middleware: interruptMw
      ? [createFilesystemMiddleware({ backend, tools: ["ls", "read_file", "glob", "grep"] }), interruptMw]
      : [createFilesystemMiddleware({ backend, tools: ["ls", "read_file", "glob", "grep"] })],
  });

  let messages: BaseMessageLike[] = deps.chatMessages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal.outcome = null;
    await agent.invoke(
      { messages },
      { recursionLimit: deps.recursionLimit ?? 24, callbacks: deps.callbacks },
    );
    const outcome = signal.outcome as ResponseOutcome | null;
    if (outcome) return outcome;
    // 模型直接输出普通文本 → 提示改用 response 后重试
    if (attempt < maxAttempts) {
      messages = nudgeWithLastText(messages);
      continue;
    }
    // 降级兜底：最后几轮里若有成形的纯文本 AIMessage，作为回复发出（打 degraded 标记），避免硬失败
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as unknown;
      if (AIMessage.isInstance(m)) {
        const t = String(m.content ?? "").trim();
        if (t && t.length > 1 && !t.startsWith("系统提示：")) {
          return { kind: "response", text: t, sleepSeconds: 0, degraded: true };
        }
      }
    }
    const trace = messages
      .slice(-8)
      .map((m) => {
        const mm = m as { constructor: { name: string }; tool_calls?: { name: string }[]; content?: unknown; tool_call_id?: string };
        const tc = mm.tool_calls?.map((t) => t.name).join(",") ?? "";
        const c = typeof mm.content === "string" ? mm.content.slice(0, 80) : JSON.stringify(mm.content)?.slice(0, 80);
        return `${mm.constructor.name}${tc ? "(" + tc + ")" : ""}${mm.tool_call_id ? "[toolres]" : ""}: ${c}`;
      })
      .join(" | ");
    throw new ResponseContractError(`模型多次未通过 response 工具输出回复；轨迹: ${trace}`);
  }
  throw new ResponseContractError("模型多次未通过 response 工具输出回复");
}

function nudgeWithLastText(messages: BaseMessageLike[]): BaseMessageLike[] {
  const last = messages.at(-1) as AIMessage | undefined;
  const text = last && AIMessage.isInstance(last) ? String(last.content ?? "") : "";
  const note = text.trim()
    ? `${RESPONSE_NUDGE}\n（你刚才的输出是：${String(last!.content).slice(0, 800)}）`
    : RESPONSE_NUDGE;
  return [...messages, new HumanMessage(note)];
}

export class ResponseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseContractError";
  }
}

export type ConfigAgentDeps = {
  model: BaseLanguageModel;
  modelKey: string;
  draftRootDir: string;
  instructionMarkdown: string;
  chatMessages: ChatTurn[];
  onValidate: () => Promise<{ ok: boolean; readiness: unknown; blockers: string[] }>;
  onPublish: () => Promise<{ ok: boolean; version?: number; message: string }>;
  onEvent?: (e: AgentEvent) => void;
  callbacks?: Callbacks;
  recursionLimit?: number;
  /** 额外工具（web_search / web_fetch），提供时附加联网研究规范 */
  extraTools?: import("@langchain/core/tools").StructuredToolInterface[];
  /** 返回 true 表示用户已发来新输入，应立即中断本次运行 */
  checkInterrupt?: () => Promise<boolean>;
};

/** 配置 Agent：读写草稿 + validate/publish + response */
export type ConfigRunResult = { reply: string; askUser: { intro: string; questions: { question: string; options: string[] }[] } | null };

export async function runConfigAgent(deps: ConfigAgentDeps): Promise<ConfigRunResult> {
  ensureHarnessProfile(deps.modelKey);
  const signal = { outcome: null as ResponseOutcome | null };
  const { responseTool, askUserTool } = createSignalTools(signal, deps.onEvent);
  const { validateTool, publishTool } = createConfigCapabilityTools({
    onValidate: deps.onValidate,
    onPublish: deps.onPublish,
    onEvent: deps.onEvent,
  });
  const backend = new FilesystemBackend({ rootDir: deps.draftRootDir, virtualMode: true });
  const interruptMw = createInterruptMiddleware(deps.checkInterrupt);
  const agent = createDeepAgent({
    model: deps.model,
    systemPrompt:
      `${deps.instructionMarkdown.trim()}\n${CONFIG_STYLE_RULES}` + (deps.extraTools?.length ? WEB_TOOL_RULES : ""),
    backend,
    tools: deps.extraTools?.length
      ? [responseTool, askUserTool, validateTool, publishTool, ...deps.extraTools]
      : [responseTool, askUserTool, validateTool, publishTool],
    middleware: interruptMw
      ? [createFilesystemMiddleware({ backend, tools: ["ls", "read_file", "glob", "grep", "write_file", "edit_file"] }), interruptMw]
      : [createFilesystemMiddleware({ backend, tools: ["ls", "read_file", "glob", "grep", "write_file", "edit_file"] })],
  });

  let messages: BaseMessageLike[] = deps.chatMessages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal.outcome = null;
    await agent.invoke(
      { messages },
      { recursionLimit: deps.recursionLimit ?? 40, callbacks: deps.callbacks },
    );
    const outcome = signal.outcome as ResponseOutcome | null;
    if (outcome?.kind === "response") {
      return { reply: outcome.text, askUser: null };
    }
    if (outcome?.kind === "ask_user") {
      return { reply: "", askUser: { intro: outcome.intro, questions: outcome.questions } };
    }
    if (outcome?.kind === "ask_human") {
      // 配置 Agent 不应请求人工；把问题转述给商户
      return { reply: outcome.question, askUser: null };
    }
    messages = nudgeWithLastText(messages);
  }
  throw new ResponseContractError("配置模型多次未通过 response / ask_user 工具输出");
}
