import { useEffect, useState } from "react";
import { api } from "../../auth";

export function AdminOverview() {
  const [data, setData] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    api<Record<string, number>>("/api/admin/overview").then(setData);
  }, []);
  const cards: [string, string][] = [
    ["merchants", "商户总数"],
    ["services", "客服总数"],
    ["active_runs", "运行中 / 排队 Run"],
    ["pending_handoffs", "待处理人工求助"],
    ["active_providers", "启用中的 Provider"],
  ];
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">平台概览</h1>
      <div className="grid gap-4 md:grid-cols-5">
        {cards.map(([k, label]) => (
          <div key={k} className="card p-5">
            <p className="text-3xl font-bold text-slate-800">{data ? data[k] ?? 0 : "—"}</p>
            <p className="mt-1 text-sm text-slate-500">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
