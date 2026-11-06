import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, useAuth } from "../../auth";
import { Logo } from "../../components/Logo";

const LINKS = [
  { to: "/admin", label: "概览", end: true },
  { to: "/admin/users", label: "商户" },
  { to: "/admin/services", label: "客服" },
  { to: "/admin/invites", label: "邀请码" },
  { to: "/admin/llm", label: "LLM 配置" },
  { to: "/admin/settings", label: "平台设置" },
  { to: "/admin/audit-logs", label: "审计日志" },
];

export function AdminLayout() {
  const { admin, refresh } = useAuth();
  const nav = useNavigate();

  const logout = async () => {
    await api("/api/admin/auth/logout", { method: "POST" }).catch(() => {});
    await refresh();
    nav("/admin/login");
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2.5"><Logo size={24} light /><span className="text-sm text-slate-300">管理后台</span></span>
            <nav className="flex gap-1 text-sm">
              {LINKS.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 ${isActive ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10"}`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">{admin?.email}</span>
            <button onClick={logout} className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/10">退出</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
