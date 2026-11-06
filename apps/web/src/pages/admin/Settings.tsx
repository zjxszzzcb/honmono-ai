import { useCallback, useEffect, useState } from "react";
import { api } from "../../auth";

export function AdminSettings() {
  const [settings, setSettings] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setSettings(await api<Record<string, number>>("/api/admin/settings"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
    setMsg("已保存");
    setTimeout(() => setMsg(""), 2500);
  };

  const fields: [string, string][] = [
    ["queue_full_limit", "队列满阈值（超过直接 429）"],
    ["chat_run_timeout_seconds", "Run 超时（秒）"],
    ["max_file_mb", "单文件上限（MB）"],
    ["max_files_per_service", "每客服文件数上限"],
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">平台设置</h1>
      {msg && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{msg}</div>}
      <div className="card max-w-xl p-5">
        {fields.map(([k, label]) => (
          <div key={k} className="mb-4">
            <label className="label">{label}</label>
            <input
              type="number"
              className="input"
              value={settings[k] ?? ""}
              onChange={(e) => setSettings((p) => ({ ...p, [k]: Number(e.target.value) }))}
            />
          </div>
        ))}
        <button className="btn-primary" onClick={save}>保存</button>
      </div>
      <p className="mt-4 text-xs text-slate-400">基础设施密钥（数据库、Redis、Langfuse 等）由部署环境变量管理，不在页面展示。</p>
    </div>
  );
}

type Log = { id: string; admin_email: string | null; action: string; resource_type: string; resource_id: string | null; result: string; created_at: string; after: Record<string, unknown> | null };

export function AdminAuditLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  useEffect(() => {
    api<Log[]>("/api/admin/audit-logs").then(setLogs);
  }, []);
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">审计日志</h1>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-3">时间</th><th className="px-5 py-3">操作者</th><th className="px-5 py-3">动作</th>
              <th className="px-5 py-3">资源</th><th className="px-5 py-3">结果</th><th className="px-5 py-3">变更</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="px-5 py-3 text-slate-500">{new Date(l.created_at).toLocaleString()}</td>
                <td className="px-5 py-3">{l.admin_email}</td>
                <td className="px-5 py-3 font-mono text-xs">{l.action}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{l.resource_type}{l.resource_id ? `/${l.resource_id.slice(0, 8)}` : ""}</td>
                <td className="px-5 py-3">{l.result === "success" ? <span className="badge bg-green-50 text-green-600">成功</span> : <span className="badge bg-red-50 text-red-500">{l.result}</span>}</td>
                <td className="max-w-[280px] truncate px-5 py-3 font-mono text-[11px] text-slate-400" title={JSON.stringify(l.after)}>
                  {l.after ? JSON.stringify(l.after).slice(0, 80) : "—"}
                </td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">暂无记录</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
