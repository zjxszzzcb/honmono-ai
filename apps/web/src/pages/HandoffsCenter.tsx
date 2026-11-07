import { useCallback, useEffect, useState } from "react";
import { api } from "../auth";
import { MerchantLayout } from "./layout";
import { HandoffCard, HANDOFF_STATE_LABEL, type Handoff } from "../components/HandoffCard";

/** 全局人工接管工作台：跨客服的转人工工单 */
export function HandoffsCenter() {
  return (
    <MerchantLayout active="handoffs">
      <Center />
    </MerchantLayout>
  );
}

function Center() {
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [tab, setTab] = useState<"pending" | "human_controlled" | "closed">("pending");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setHandoffs(await api<Handoff[]>("/api/handoffs"));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const pending = handoffs.filter((h) => h.state === "pending");
  const human = handoffs.filter((h) => h.state === "human_controlled");
  const closed = handoffs.filter((h) => h.state === "assisted_reply" || h.state === "resolved");
  const visible = tab === "pending" ? pending : tab === "human_controlled" ? human : closed;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">人工接管台</h1>
          <p className="mt-1 text-sm text-slate-500">
            AI 无法确认或客户要求人工时会转到这里：选用建议回复、编辑后发送，或直接接管会话，处理完交还 AI。
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {(
            [
              ["pending", `待处理 ${pending.length ? `(${pending.length})` : ""}`],
              ["human_controlled", `接管中 ${human.length ? `(${human.length})` : ""}`],
              ["closed", "已处理"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3.5 py-1.5 text-sm ${
                tab === k ? "bg-[#FF5000] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="card p-10 text-center text-slate-400">加载中…</div>}
      {!loading && visible.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-3xl">🌤️</p>
          <p className="mt-2 font-medium text-slate-600">{EMPTY_TITLE[tab]}</p>
          <p className="mt-1 text-sm text-slate-400">{EMPTY_DESC[tab]}</p>
        </div>
      )}
      <div className="space-y-4">
        {visible.map((h) => (
          <HandoffCard key={h.id} serviceId={h.service_id!} handoff={h} onChanged={load} showService />
        ))}
      </div>
    </div>
  );
}

const EMPTY_TITLE: Record<string, string> = {
  pending: "没有待处理的转人工请求",
  human_controlled: "没有正在接管的会话",
  closed: "还没有处理记录",
};
const EMPTY_DESC: Record<string, string> = {
  pending: "AI 遇到不确定的问题时会自动转到这里，稍安勿躁～",
  human_controlled: "接管会话后可以在这里继续人工回复。",
  closed: "处理过的转人工请求会归档在这里。",
};
