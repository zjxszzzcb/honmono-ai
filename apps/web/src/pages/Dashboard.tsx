import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useAuth } from "../auth";
import { MerchantLayout, STATUS_BADGE } from "./layout";

type Svc = { id: string; name: string; status: string; created_at?: string; createdAt?: string };

export function Dashboard() {
  return (
    <MerchantLayout active="dashboard">
      <DashboardInner />
    </MerchantLayout>
  );
}

function DashboardInner() {
  const [services, setServices] = useState<Svc[]>([]);
  const [busy, setBusy] = useState(false);
  const { merchant, refresh } = useAuth();
  const nav = useNavigate();

  const load = useCallback(async () => {
    setServices(await api<Svc[]>("/api/customer-services"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const s = await api<{ id: string }>("/api/customer-services", { method: "POST", body: JSON.stringify({}) });
      nav(`/services/${s.id}/configure`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">我的 AI 客服</h1>
          <p className="mt-1 text-sm text-slate-500">
            {merchant?.activated ? "权益已激活，可以创建客服。" : "尚未激活权益：创建客服前请先兑换邀请码。"}
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={merchant?.activated ? create : () => nav("/activate")}
          disabled={busy}
        >
          {merchant?.activated ? (busy ? "创建中…" : "+ 一键创建客服") : "先去激活权益"}
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {services.map((s) => (
          <div key={s.id} className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">{s.name}</h3>
              <span className={`badge ${STATUS_BADGE[s.status] ?? "bg-slate-100"}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
            </div>
            <p className="mb-4 text-xs text-slate-400">创建于 {new Date(s.created_at ?? s.createdAt ?? "").toLocaleString()}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link className="btn-ghost" to={`/services/${s.id}/configure`}>配置</Link>
              <Link className="btn-ghost" to={`/services/${s.id}/test`}>测试</Link>
              <Link className="btn-ghost" to={`/services/${s.id}/keys`}>API Key</Link>
              <Link className="btn-ghost" to={`/services/${s.id}/handoffs`}>
                人工求助
              </Link>
            </div>
          </div>
        ))}
        {services.length === 0 && (
          <div className="card col-span-full p-10 text-center text-slate-400">
            还没有客服，点击右上角「一键创建客服」开始
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  configuring: "配置中",
  ready: "可用",
  disabled: "已停用",
};
