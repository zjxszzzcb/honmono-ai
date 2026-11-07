import { useCallback, useEffect, useState } from "react";
import { api } from "../../auth";

type Svc = { id: string; name: string; merchant_account: string | null; status: string; active_runs: number; created_at: string };

export function AdminServices() {
  const [services, setServices] = useState<Svc[]>([]);
  const load = useCallback(async () => {
    setServices(await api<Svc[]>("/api/admin/customer-services"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: string) => {
    if (action === "revoke-keys" && !confirm("确定删除该客服全部 API Key？")) return;
    await api(`/api/admin/customer-services/${id}/${action}`, { method: "POST" });
    load();
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">客服管理</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-3">名称</th><th className="px-5 py-3">所属商户</th><th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">活跃 Run</th><th className="px-5 py-3">创建时间</th><th></th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-b border-slate-50">
                <td className="px-5 py-3 font-medium">{s.name}</td>
                <td className="px-5 py-3 text-slate-500">{s.merchant_account}</td>
                <td className="px-5 py-3">{s.status === "ready" ? <span className="badge bg-green-50 text-green-600">可用</span> : s.status === "configuring" ? <span className="badge bg-amber-50 text-amber-600">配置中</span> : <span className="badge bg-slate-100 text-slate-500">{s.status}</span>}</td>
                <td className="px-5 py-3">{s.active_runs}</td>
                <td className="px-5 py-3 text-slate-500">{new Date(s.created_at).toLocaleString()}</td>
                <td className="px-5 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {s.status === "disabled"
                      ? <button className="btn-ghost" onClick={() => act(s.id, "enable")}>恢复</button>
                      : <button className="btn-danger" onClick={() => act(s.id, "disable")}>停用</button>}
                    <button className="btn-danger" onClick={() => act(s.id, "revoke-keys")}>删除 Key</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
