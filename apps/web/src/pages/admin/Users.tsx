import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../auth";

type User = { id: string; account: string; status: string; activated: boolean; service_count: number; created_at: string; last_login_at: string | null };

export function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setUsers(await api<User[]>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`));
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: string) => {
    await api(`/api/admin/users/${id}/${action}`, { method: "POST" });
    load();
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">商户管理</h1>
      <input className="input mb-4 max-w-sm" placeholder="搜索账号…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-3">账号</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">权益</th>
              <th className="px-5 py-3">客服数</th><th className="px-5 py-3">注册时间</th><th className="px-5 py-3">最近登录</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-50">
                <td className="px-5 py-3"><Link className="text-blue-600 hover:underline" to={`/admin/users/${u.id}`}>{u.account}</Link></td>
                <td className="px-5 py-3">{u.status === "active" ? <span className="badge bg-green-50 text-green-600">正常</span> : <span className="badge bg-red-50 text-red-500">{u.status === "disabled" ? "已停用" : u.status}</span>}</td>
                <td className="px-5 py-3">{u.activated ? "已激活" : "未激活"}</td>
                <td className="px-5 py-3">{u.service_count}</td>
                <td className="px-5 py-3 text-slate-500">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-slate-500">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                <td className="px-5 py-3 text-right">
                  {u.status === "active"
                    ? <button className="btn-danger" onClick={() => act(u.id, "disable")}>停用</button>
                    : <button className="btn-ghost" onClick={() => act(u.id, "enable")}>启用</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Detail = {
  id: string; account: string; status: string; created_at: string; last_login_at: string | null;
  services: { id: string; name: string; status: string }[];
  purchases: { redeemed_at: string; invite_prefix: string | null }[];
};

export function AdminUserDetail() {
  const [d, setD] = useState<Detail | null>(null);
  const id = window.location.pathname.split("/").pop()!;
  useEffect(() => {
    api<Detail>(`/api/admin/users/${id}`).then(setD);
  }, [id]);
  if (!d) return null;
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">{d.account}</h1>
      <p className="mb-6 text-sm text-slate-500">状态 {d.status} · 注册 {new Date(d.created_at).toLocaleString()}</p>
      <div className="card mb-4 p-5">
        <h2 className="mb-3 font-semibold">客服（{d.services.length}）</h2>
        <ul className="space-y-1 text-sm">
          {d.services.map((s) => (
            <li key={s.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>{s.name}</span><span className="text-slate-400">{s.status}</span>
            </li>
          ))}
          {d.services.length === 0 && <li className="text-slate-400">无</li>}
        </ul>
      </div>
      <div className="card p-5">
        <h2 className="mb-3 font-semibold">激活记录</h2>
        <ul className="space-y-1 text-sm">
          {d.purchases.map((p, i) => (
            <li key={i} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="font-mono text-xs">{p.invite_prefix}…</span>
              <span className="text-slate-400">{new Date(p.redeemed_at).toLocaleString()}</span>
            </li>
          ))}
          {d.purchases.length === 0 && <li className="text-slate-400">无</li>}
        </ul>
      </div>
    </div>
  );
}
