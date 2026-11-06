import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, useAuth } from "../../auth";
import { Logo } from "../../components/Logo";

export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { setAdmin, refresh } = useAuth();
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const a = await api<{ id: string; email: string }>("/api/admin/auth/login", { method: "POST", body: JSON.stringify({ account: email, password }) });
      setAdmin(a);
      await refresh();
      nav("/admin");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-7 shadow-lg">
        <div className="mb-4"><Logo size={30} /></div>
        <h1 className="mb-1 text-xl font-bold">管理员登录</h1>
        <p className="mb-6 text-sm text-slate-500">Honmono AI 平台管理后台</p>
        <label className="label">邮箱</label>
        <input className="input mb-4" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="label">密码</label>
        <input className="input mb-5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
      </form>
    </div>
  );
}
