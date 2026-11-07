import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../auth";
import { MerchantLayout } from "./layout";

type Handoff = {
  id: string;
  conversation_id: string;
  state: string;
  reason: string;
  question: string;
  context_summary: string | null;
  suggested_replies: string[] | null;
  conversation_control_state: string;
  created_at: string;
  messages: { id: number; role: string; author_type: string; content: string }[];
};

export function Handoffs() {
  const { id } = useParams<{ id: string }>();
  return (
    <MerchantLayout>
      <HandoffsInner id={id!} />
    </MerchantLayout>
  );
}

const STATE_LABEL: Record<string, [string, string]> = {
  pending: ["待处理", "bg-amber-100 text-amber-700"],
  assisted_reply: ["已建议回复", "bg-green-100 text-green-700"],
  human_controlled: ["人工接管中", "bg-blue-50 text-sky-600"],
  resolved: ["已结束", "bg-slate-100 text-slate-500"],
};

function HandoffsInner({ id }: { id: string }) {
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [controlState, setControlState] = useState<string | null>(null);

  const load = useCallback(async () => {
    const hs = await api<Handoff[]>(`/api/customer-services/${id}/handoffs`);
    setHandoffs(hs);
    const open = hs.find((h) => h.state === "human_controlled");
    if (open) {
      const conv = await api<{ control_state: string }>(`/api/customer-services/${id}/conversations/${open.messages.length ? "" : ""}`.replace(/\/$/, "")).catch(() => null);
      void conv;
      setControlState("human_controlled");
    } else {
      setControlState(null);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const reply = async (hid: string, text: string) => {
    await api(`/api/customer-services/${id}/handoffs/${hid}/reply`, { method: "POST", body: JSON.stringify({ text }) });
    load();
  };

  const takeover = async (hid: string) => {
    await api(`/api/customer-services/${id}/handoffs/${hid}/takeover`, { method: "POST" });
    load();
  };

  const sendHuman = async (hid: string, text: string) => {
    const h = handoffs.find((x) => x.id === hid);
    if (!h) return;
    await api(`/api/customer-services/${id}/conversations/${h.conversation_id}/reply`, { method: "POST", body: JSON.stringify({ text }) });
    load();
  };

  const release = async (hid: string) => {
    const h = handoffs.find((x) => x.id === hid);
    if (!h) return;
    await api(`/api/customer-services/${id}/conversations/${h.conversation_id}/release`, { method: "POST" });
    load();
  };

  const pending = handoffs.filter((h) => h.state === "pending");
  const human = handoffs.filter((h) => h.state === "human_controlled");
  const closed = handoffs.filter((h) => h.state === "assisted_reply" || h.state === "resolved");

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">转人工</h1>
      <p className="mb-6 text-sm text-slate-500">AI 无法确认时会转人工：选择建议回复、编辑后发送，或直接接管会话。</p>

      {pending.length === 0 && human.length === 0 && closed.length === 0 && (
        <div className="card p-10 text-center text-slate-400">暂无转人工</div>
      )}

      {[...pending, ...human].map((h) => (
        <HandoffCard
          key={h.id}
          h={h}
          draft={drafts[h.id] ?? h.suggested_replies?.[0] ?? ""}
          onDraft={(t) => setDrafts((p) => ({ ...p, [h.id]: t }))}
          onReply={() => reply(h.id, drafts[h.id] ?? h.suggested_replies?.[0] ?? "")}
          onTakeover={() => takeover(h.id)}
          onSendHuman={(t) => sendHuman(h.id, t)}
          onRelease={() => release(h.id)}
        />
      ))}

      {closed.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-400">已处理</h2>
          <div className="space-y-2">
            {closed.map((h) => (
              <div key={h.id} className="card flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-slate-600">{h.question.slice(0, 80)}</span>
                <span className={`badge ${STATE_LABEL[h.state]?.[1]}`}>{STATE_LABEL[h.state]?.[0]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HandoffCard(props: {
  h: Handoff;
  draft: string;
  onDraft: (t: string) => void;
  onReply: () => void;
  onTakeover: () => void;
  onSendHuman: (t: string) => void;
  onRelease: () => void;
}) {
  const { h, draft, onDraft, onReply, onTakeover, onSendHuman, onRelease } = props;
  const [label, cls] = STATE_LABEL[h.state] ?? [h.state, "bg-slate-100"];
  const takenOver = h.state === "human_controlled";

  return (
    <div className="card mb-4 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`badge ${cls}`}>{label}</span>
          <span className="text-xs text-slate-400">{new Date(h.created_at).toLocaleString()}</span>
        </div>
        <span className="text-xs text-slate-400">会话状态：{CONV_LABEL[h.conversation_control_state] ?? h.conversation_control_state}</span>
      </div>
      <p className="mb-1 text-sm"><span className="font-medium text-slate-500">求助原因：</span>{h.reason}</p>
      <p className="mb-3 text-sm"><span className="font-medium text-slate-500">需要人工：</span>{h.question}</p>
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
                    onClick={() => onDraft(s)}
                    className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      draft === s ? "border-blue-400 bg-blue-50 text-[#c2410c]" : "border-slate-200 hover:bg-slate-50"
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
            onChange={(e) => onDraft(e.target.value)}
            placeholder="编辑回复内容后发送，发送后 AI 恢复自动应答"
          />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={onReply} disabled={!draft.trim()}>发送并恢复 AI</button>
            <button className="btn-ghost" onClick={onTakeover}>直接接管会话</button>
          </div>
        </>
      ) : (
        <>
          <textarea
            className="input mb-3 min-h-[72px]"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="以人工身份输入回复…"
          />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => onSendHuman(draft)} disabled={!draft.trim()}>发送人工回复</button>
            <button className="btn-ghost" onClick={onRelease}>交还 AI</button>
          </div>
        </>
      )}
    </div>
  );
}

const CONV_LABEL: Record<string, string> = {
  ai: "AI 处理中",
  pending_human: "等待人工",
  human_controlled: "人工接管中",
};
