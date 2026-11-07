import { useState } from "react";
import { api } from "../auth";

export type Handoff = {
  id: string;
  conversation_id: string;
  service_id?: string;
  service_name?: string;
  state: string;
  reason: string;
  question: string;
  context_summary: string | null;
  suggested_replies: string[] | null;
  conversation_control_state: string | null;
  created_at: string;
  messages: { id: number; role: string; author_type: string; content: string }[];
};

export const HANDOFF_STATE_LABEL: Record<string, [string, string]> = {
  pending: ["待处理", "bg-amber-100 text-amber-700"],
  assisted_reply: ["已建议回复", "bg-green-100 text-green-700"],
  human_controlled: ["人工接管中", "bg-sky-100 text-sky-700"],
  resolved: ["已结束", "bg-slate-100 text-slate-500"],
};

const CONV_LABEL: Record<string, string> = {
  ai: "AI 处理中",
  pending_human: "等待人工",
  human_controlled: "人工接管中",
};

export function HandoffCard({
  serviceId,
  handoff: h,
  onChanged,
  showService = false,
}: {
  serviceId: string;
  handoff: Handoff;
  onChanged: () => void;
  showService?: boolean;
}) {
  const [draft, setDraft] = useState(h.suggested_replies?.[0] ?? "");
  const [label, cls] = HANDOFF_STATE_LABEL[h.state] ?? [h.state, "bg-slate-100"];
  const takenOver = h.state === "human_controlled";

  const reply = async () => {
    await api(`/api/customer-services/${serviceId}/handoffs/${h.id}/reply`, { method: "POST", body: JSON.stringify({ text: draft }) });
    onChanged();
  };
  const takeover = async () => {
    await api(`/api/customer-services/${serviceId}/handoffs/${h.id}/takeover`, { method: "POST" });
    onChanged();
  };
  const sendHuman = async () => {
    await api(`/api/customer-services/${serviceId}/conversations/${h.conversation_id}/reply`, { method: "POST", body: JSON.stringify({ text: draft }) });
    onChanged();
  };
  const release = async () => {
    await api(`/api/customer-services/${serviceId}/conversations/${h.conversation_id}/release`, { method: "POST" });
    onChanged();
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`badge ${cls}`}>{label}</span>
          {showService && h.service_name && <span className="badge badge-brand">{h.service_name}</span>}
          <span className="text-xs text-slate-400">{new Date(h.created_at).toLocaleString()}</span>
        </div>
        {h.conversation_control_state && (
          <span className="text-xs text-slate-400">会话状态：{CONV_LABEL[h.conversation_control_state] ?? h.conversation_control_state}</span>
        )}
      </div>
      <p className="mb-1 text-sm">
        <span className="font-medium text-slate-500">转人工原因：</span>
        {h.reason}
      </p>
      <p className="mb-3 text-sm">
        <span className="font-medium text-slate-500">需要人工：</span>
        {h.question}
      </p>
      {h.context_summary && (
        <details className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <summary className="cursor-pointer select-none">会话上下文摘要</summary>
          <p className="mt-1.5 whitespace-pre-wrap">{h.context_summary}</p>
        </details>
      )}

      {!takenOver ? (
        <>
          {h.suggested_replies && h.suggested_replies.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-xs font-medium text-slate-500">AI 建议回复（点击选用）：</p>
              <div className="space-y-1.5">
                {h.suggested_replies.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setDraft(s)}
                    className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      draft === s ? "border-[#FF5000] bg-orange-50 text-[#c2410c]" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <textarea
            className="input mb-3 min-h-[72px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="编辑回复内容后发送，发送后 AI 恢复自动应答"
          />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={reply} disabled={!draft.trim()}>
              发送并恢复 AI
            </button>
            <button className="btn-ghost" onClick={takeover}>
              直接接管会话
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            className="input mb-3 min-h-[72px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="以人工身份输入回复…"
          />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={sendHuman} disabled={!draft.trim()}>
              发送人工回复
            </button>
            <button className="btn-ghost" onClick={release}>
              交还 AI
            </button>
          </div>
        </>
      )}
    </div>
  );
}
