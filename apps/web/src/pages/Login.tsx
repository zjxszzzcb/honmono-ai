import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useAuth } from "../auth";
import { Logo } from "../components/Logo";

export function Login() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { setMerchant, refresh } = useAuth();
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const m = await api<{ id: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ account, password }) });
      setMerchant({ id: m.id, account, activated: false });
      await refresh();
      nav("/dashboard");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-7">
        <div className="mb-4"><Logo size={30} /></div>
        <h1 className="mb-1 text-xl font-bold">登录商户控制台</h1>
        <p className="mb-6 text-sm text-slate-500">还没有账号？<Link to="/register" className="text-[#FF5000] hover:underline">注册</Link></p>
        <label className="label">账号</label>
        <input className="input mb-4" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="邮箱或用户名" required />
        <label className="label">密码</label>
        <input className="input mb-5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
      </form>
    </div>
  );
}

export function Register() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { setMerchant, refresh } = useAuth();
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const m = await api<{ id: string }>("/api/auth/register", { method: "POST", body: JSON.stringify({ account, password }) });
      setMerchant({ id: m.id, account, activated: false });
      await refresh();
      nav("/activate");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-7">
        <h1 className="mb-1 text-xl font-bold">注册</h1>
        <p className="mb-6 text-sm text-slate-500">已有账号？<Link to="/login" className="text-[#FF5000] hover:underline">登录</Link></p>
        <label className="label">账号（邮箱）</label>
        <input className="input mb-4" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="you@example.com" required />
        <label className="label">密码（至少 8 位）</label>
        <input className="input mb-5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {err && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "注册中…" : "注册"}</button>
      </form>
    </div>
  );
}
