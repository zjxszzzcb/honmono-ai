import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MerchantLayout } from "./layout";
import { Composer } from "../components/Composer";
import { TypewriterText } from "../components/Typewriter";

type TimelineEvent = { kind: string; text: string; at: number };

export function TestPlayground() {
  const { id } = useParams<{ id: string }>();
  return (
    <MerchantLayout>
      <TestInner id={id!} />
    </MerchantLayout>
  );
}

type Bubble = { key: number; role: "user" | "ai" | "system"; content: string };

function TestInner({ id }: { id: string }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [useDraft, setUseDraft] = useState(true);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [streamTarget, setStreamTarget] = useState<{ key: number; text: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef(1);
  const nextKey = () => keyRef.current++;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles.length, events.length, streamTarget?.text.length]);

  const upload = async (list: FileList) => {
    const form = new FormData();
    for (const f of Array.from(list)) form.append("files", f);
    const res = await fetch(`/api/customer-services/${id}/files`, { method: "POST", body: form, credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert((body as { message?: string }).message ?? "上传失败");
    }
  };

  const send = async (content: string) => {
    if (running) return;
    setRunning(true);
    setLastStatus(null);
    setEvents([]);
    const userKey = nextKey();
    const aiKey = nextKey();
    setBubbles((prev) => [...prev, { key: userKey, role: "user", content }]);
    setStreamTarget({ key: aiKey, text: "" });

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
      let aiText = "";
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
            setEvents((p) => [
              ...p,
              { kind: "skill", text: `加载技能 ${data.mode === "draft" ? "草稿" : `v${data.version}`}（v${data.version}）`, at: Date.now() },
            ]);
          } else if (event === "tool.started") {
            setEvents((p) => [...p, { kind: "tool", text: `工具 ${data.name}：${data.summary ?? ""}`, at: Date.now() }]);
          } else if (event === "response.delta") {
            aiText += String(data.text ?? "");
            setStreamTarget({ key: aiKey, text: aiText });
          } else if (event === "ask_human") {
            setLastStatus("waiting_for_human");
            setEvents((p) => [...p, { kind: "human", text: `转人工：${data.question}`, at: Date.now() }]);
            setBubbles((prev) => [
              ...prev,
              { key: nextKey(), role: "system", content: `⏸ 已创建转人工（原因：${data.reason}）。可在「转人工」页处理。` },
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
      setStreamTarget((st) => {
        if (st && st.text) {
          setBubbles((prev) =>
            prev.some((b) => b.key === st.key)
              ? prev.map((b) => (b.key === st.key ? { ...b, content: st.text } : b))
              : [...prev, { key: st.key, role: "ai", content: st.text }],
          );
        }
        return null;
      });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="card flex h-[calc(100vh-150px)] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-[17px] font-semibold text-slate-900">测试台</h2>
            <p className="mt-0.5 text-xs text-slate-400">与生产 /chat 完全独立的测试会话</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} className="accent-[#FF5000]" />
            使用草稿版本
          </label>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {bubbles.length === 0 && !streamTarget && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-500">
              以玩家身份发送消息试试，右侧会显示执行事件时间线。
            </div>
          )}
          {bubbles.map((b) => (
            <div key={b.key} className={`msg-enter flex ${b.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={b.role === "user" ? "bubble-user" : b.role === "system" ? "bubble-system" : "bubble-ai"}>
                {b.content}
              </div>
            </div>
          ))}
          {streamTarget && (
            <div className="msg-enter flex justify-start">
              <div className="bubble-ai">
                {streamTarget.text.length > 0 ? (
                  <TypewriterText text={streamTarget.text} enabled={true} />
                ) : (
                  <span className="flex items-center gap-1.5 text-slate-400">
                    AI 正在处理
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </span>
                )}
              </div>
            </div>
          )}
          {running && !streamTarget && (
            <div className="flex justify-start">
              <div className="bubble-ai flex items-center gap-1.5 !text-slate-400">
                AI 正在处理
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {lastStatus === "waiting_for_human" && (
          <div className="border-t border-amber-100 bg-amber-50/80 px-6 py-2.5 text-xs text-amber-700">
            本会话已转人工：可在「转人工」页选择建议回复或接管；处理后 AI 恢复自动应答。
          </div>
        )}
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <Composer
            placeholder="以玩家身份输入消息…"
            disabled={running}
            onSend={send}
            sendLabel="Enter 发送"
            attach={{ onFiles: upload }}
            attachLabel="上传资料"
          />
        </div>
      </div>

      <div className="card h-[calc(100vh-150px)] overflow-y-auto p-5">
        <h3 className="mb-3 font-semibold text-slate-900">执行事件时间线</h3>
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
  status: "bg-orange-400",
  skill: "bg-violet-400",
  tool: "bg-cyan-400",
  human: "bg-amber-400",
  done: "bg-green-400",
  error: "bg-red-400",
};
