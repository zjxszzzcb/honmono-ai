import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../auth";
import { MerchantLayout } from "./layout";

type Msg = { id: number; role: string; author_type: string; content: string; created_at: string };
type TimelineEvent = { kind: string; text: string; at: number };

export function TestPlayground() {
  const { id } = useParams<{ id: string }>();
  return (
    <MerchantLayout>
      <TestInner id={id!} />
    </MerchantLayout>
  );
}

function TestInner({ id }: { id: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [useDraft, setUseDraft] = useState(true);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    // 测试会话消息通过 handoffs 页不可见；用公开格式接口拿不到，直接读取 config 无关。
    // 简化：测试历史从 /api/customer-services/:id/handoffs 无关，这里改用本地展示运行中消息。
  }, [id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, events.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content || running) return;
    setInput("");
    setRunning(true);
    setLastStatus(null);
    setEvents([]);
    let aiText = "";
    const localId = Date.now();
    setMessages((prev) => [...prev, { id: localId, role: "user", author_type: "end_user", content, created_at: new Date().toISOString() }]);

    try {
      const res = await fetch(`/api/customer-services/${id}/test-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content, use_draft: useDraft, reset: false }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `测试请求失败 (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const evLine = chunk.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!evLine) continue;
          const event = evLine.slice(6).trim();
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(dataLine?.slice(5) ?? "{}");
          } catch {
            /* ignore */
          }
          if (event === "run.status") {
            setEvents((p) => [...p, { kind: "status", text: `运行状态：${data.state}`, at: Date.now() }]);
          } else if (event === "skill.loaded") {
            setEvents((p) => [...p, { kind: "skill", text: `加载技能 ${data.mode === "draft" ? "草稿" : "v" + data.version}（v${data.version}）`, at: Date.now() }]);
          } else if (event === "tool.started") {
            setEvents((p) => [...p, { kind: "tool", text: `工具 ${data.name}：${data.summary ?? ""}`, at: Date.now() }]);
          } else if (event === "response.delta") {
            aiText += String(data.text ?? "");
            setMessages((prev) => {
              const last = prev.at(-1);
              if (last && last.id === localId + 1) {
                return [...prev.slice(0, -1), { ...last, content: aiText }];
              }
              return [...prev, { id: localId + 1, role: "assistant", author_type: "ai", content: aiText, created_at: new Date().toISOString() }];
            });
          } else if (event === "ask_human") {
            setLastStatus("waiting_for_human");
            setEvents((p) => [...p, { kind: "human", text: `转人工：${data.question}`, at: Date.now() }]);
            setMessages((prev) => [
              ...prev,
              { id: localId + 2, role: "assistant", author_type: "system", content: `⏸ 已创建人工求助（原因：${data.reason}）。可在「人工求助」页处理。`, created_at: new Date().toISOString() },
            ]);
          } else if (event === "error") {
            setEvents((p) => [...p, { kind: "error", text: String(data.message ?? "错误"), at: Date.now() }]);
          } else if (event === "done") {
            setLastStatus(String(data.status));
            setEvents((p) => [...p, { kind: "done", text: `结束：${data.status}`, at: Date.now() }]);
          }
        }
      }
    } catch (err) {
      setEvents((p) => [...p, { kind: "error", text: err instanceof Error ? err.message : String(err), at: Date.now() }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="card flex h-[calc(100vh-190px)] flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="font-semibold">测试台</h2>
            <p className="mt-0.5 text-xs text-slate-400">与生产 /chat 完全独立的测试会话</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} />
            使用草稿版本
          </label>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 && <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">以玩家身份发送消息试试，右侧会显示执行事件时间线。</div>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-blue-600 text-white"
                    : m.author_type === "system"
                      ? "rounded-bl-md border border-amber-200 bg-amber-50 text-amber-800"
                      : "rounded-bl-md bg-slate-100 text-slate-800"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {running && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-2.5 text-sm text-slate-400"><span className="animate-pulse">AI 正在处理…</span></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {lastStatus === "waiting_for_human" && (
          <div className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-700">
            本会话已转人工：可在「人工求助」页选择建议回复或接管；处理后 AI 恢复自动应答。
          </div>
        )}
        <form onSubmit={send} className="flex gap-2 border-t border-slate-100 px-5 py-3.5">
          <input className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="以玩家身份输入消息" disabled={running} />
          <button className="btn-primary" disabled={running || !input.trim()}>发送</button>
        </form>
      </div>

      <div className="card h-[calc(100vh-190px)] overflow-y-auto p-5">
        <h3 className="mb-3 font-semibold">执行事件时间线</h3>
        {events.length === 0 && <p className="text-xs text-slate-400">尚无事件</p>}
        <ol className="space-y-2.5">
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${EVENT_COLOR[e.kind] ?? "bg-slate-300"}`} />
              <span className="text-slate-600">{e.text}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-300">{new Date(e.at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const EVENT_COLOR: Record<string, string> = {
  status: "bg-blue-400",
  skill: "bg-violet-400",
  tool: "bg-cyan-400",
  human: "bg-amber-400",
  done: "bg-green-400",
  error: "bg-red-400",
};
