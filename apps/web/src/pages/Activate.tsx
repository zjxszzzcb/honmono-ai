import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, useAuth } from "../auth";
import { MerchantLayout } from "./layout";

export function Activate() {
  return (
    <MerchantLayout>
      <ActivateInner />
    </MerchantLayout>
  );
}

function ActivateInner() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api("/api/activation/redeem", { method: "POST", body: JSON.stringify({ code }) });
      setMsg("激活成功！正在跳转…");
      await refresh();
      setTimeout(() => nav("/dashboard"), 800);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "激活失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card mx-auto mt-10 w-full max-w-md p-7">
      <h1 className="mb-1 text-xl font-bold">兑换邀请码</h1>
      <p className="mb-6 text-sm text-slate-500">输入邀请码激活权益后即可创建 AI 客服。</p>
      <label className="label">邀请码</label>
      <input className="input mb-5 font-mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HON-XXXXX-XXXXX" required />
      {err && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      {msg && <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
      <button className="btn-primary w-full" disabled={busy || !code}>{busy ? "激活中…" : "激活"}</button>
    </form>
  );
}
