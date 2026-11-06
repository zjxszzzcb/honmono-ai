import { Link, useNavigate } from "react-router-dom";
import { api, useAuth } from "../auth";
import { Logo } from "../components/Logo";

const STATUS_BADGE: Record<string, string> = {
  configuring: "bg-amber-100 text-amber-700",
  ready: "bg-green-100 text-green-700",
  disabled: "bg-slate-200 text-slate-500",
};

export function MerchantLayout({ children, active }: { children: React.ReactNode; active?: string }) {
  const { merchant, refresh } = useAuth();
  const nav = useNavigate();

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    await refresh();
    nav("/");
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/dashboard"><Logo size={26} /></Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link to="/dashboard" className={`rounded-lg px-3 py-1.5 ${active === "dashboard" ? "bg-orange-50 text-[#FF5000]" : "text-slate-600 hover:bg-slate-100"}`}>我的客服</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {!merchant?.activated && (
              <Link to="/activate" className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-700 hover:bg-amber-100">兑换邀请码</Link>
            )}
            <span className="text-slate-500">{merchant?.account}</span>
            <button onClick={logout} className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100">退出</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

export { STATUS_BADGE };
