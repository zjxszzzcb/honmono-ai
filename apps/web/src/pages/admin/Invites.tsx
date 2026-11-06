import { useCallback, useEffect, useState } from "react";
import { api } from "../../auth";

type Invite = { id: string; prefix: string; max_uses: number; used_count: number; expires_at: string; status: string; created_at: string };

export function AdminInvites() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [maxUses, setMaxUses] = useState(1);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setInvites(await api<Invite[]>("/api/admin/invites"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    const res = await api<{ code: string }>("/api/admin/invites", { method: "POST", body: JSON.stringify({ max_uses: maxUses, expires_in_days: 365 }) });
    setCreatedCode(res.code);
    setCopied(false);
    load();
  };

  const disable = async (id: string) => {
    await api(`/api/admin/invites/${id}/disable`, { method: "POST" });
    load();
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">邀请码管理</h1>
      <div className="card mb-6 flex items-end gap-3 p-5">
        <div>
          <label className="label">可用次数</label>
          <input type="number" min={1} className="input w-32" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />
        </div>
        <button className="btn-primary" onClick={create}>生成邀请码</button>
      </div>

      {createdCode && (
        <div className="card mb-6 border-blue-200 bg-blue-50 p-5">
          <h3 className="mb-2 font-semibold text-blue-800">新邀请码（仅显示一次）：</h3>
          <div className="flex items-center gap-3">
            <code className="flex-1 rounded-lg bg-white px-3 py-2 font-mono text-lg tracking-wider">{createdCode}</code>
            <button className="btn-ghost" onClick={async () => { await navigator.clipboard.writeText(createdCode); setCopied(true); }}>
              {copied ? "已复制 ✓" : "复制"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-3">前缀</th><th className="px-5 py-3">次数</th><th className="px-5 py-3">有效期至</th><th className="px-5 py-3">状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.id} className="border-b border-slate-50">
                <td className="px-5 py-3 font-mono">{i.prefix}…</td>
                <td className="px-5 py-3">{i.used_count}/{i.max_uses}</td>
                <td className="px-5 py-3 text-slate-500">{new Date(i.expires_at).toLocaleDateString()}</td>
                <td className="px-5 py-3">{i.status === "active" ? <span className="badge bg-green-50 text-green-600">可用</span> : <span className="badge bg-slate-100 text-slate-500">停用</span>}</td>
                <td className="px-5 py-3 text-right">{i.status === "active" && <button className="btn-danger" onClick={() => disable(i.id)}>停用</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
