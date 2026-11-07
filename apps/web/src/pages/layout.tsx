import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api, useAuth } from "../auth";
import { Logo } from "../components/Logo";

const STATUS_BADGE: Record<string, string> = {
  configuring: "bg-amber-100 text-amber-700",
  ready: "bg-green-100 text-green-700",
  disabled: "bg-slate-200 text-slate-500",
};

export function MerchantLayout({ children, active, wide }: { children: React.ReactNode; active?: string; wide?: boolean }) {
  const { merchant, refresh } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [pendingHandoffs, setPendingHandoffs] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ state: string }[]>("/api/handoffs")
      .then((hs) => {
        if (alive) setPendingHandoffs(hs.filter((h) => h.state === "pending").length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [location.pathname]);

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
              <NavLink label="AI 客服" to="/dashboard" current={location.pathname} />
              <NavLink
                label="人工接管"
                to="/handoffs"
                current={location.pathname}
                badge={pendingHandoffs}
              />
              <NavLink label="API" to="/api-keys" current={location.pathname} />
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
      <main className={wide ? "px-4 py-5" : "mx-auto max-w-6xl px-6 py-8"}>{children}</main>
    </div>
  );
}

export { STATUS_BADGE };

function NavLink({ label, to, current, badge }: { label: string; to: string; current: string; badge?: number }) {
  const active = to === "/dashboard" ? /^\/dashboard|^\/services\//.test(current) : current.startsWith(to);
  return (
    <Link
      to={to}
      className={`relative rounded-lg px-3 py-1.5 ${active ? "bg-orange-50 text-[#FF5000]" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {label}
      {badge ? (
        <span className="absolute -right-1 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FF5000] px-1 text-[10px] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
