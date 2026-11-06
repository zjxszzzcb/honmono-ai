import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Logo } from "../components/Logo";

export function Landing() {
  const { merchant, admin } = useAuth();
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#FF6A00] to-[#E63F00] text-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Logo size={28} light />
        <div className="flex items-center gap-3 text-sm">
          {merchant ? (
            <Link to="/dashboard" className="rounded-lg bg-white/15 px-4 py-2 hover:bg-white/25">进入控制台</Link>
          ) : (
            <>
              <Link to="/login" className="rounded-lg px-3 py-2 hover:bg-white/10">登录</Link>
              <Link to="/register" className="rounded-lg bg-white text-[#E63F00] px-4 py-2 font-medium hover:bg-orange-50">注册</Link>
            </>
          )}
          <Link to="/admin" className="text-white/70 hover:text-white">管理员</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 pt-20 pb-28">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-orange-200">AI Customer Service Platform</p>
        <h1 className="max-w-2xl text-5xl font-bold leading-tight">十分钟，给你的产品一个靠谱的 AI 客服</h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-orange-50">
          聊天式配置，上传资料即学即用；版本化的客服技能、生产级 Chat API、人工接管与完整调用链路追踪。
        </p>
        <div className="mt-10 flex gap-4">
          <Link to={merchant ? "/dashboard" : "/register"} className="rounded-xl bg-white px-6 py-3 font-medium text-[#E63F00] hover:bg-orange-50">
            {merchant ? "进入控制台" : "免费开始"}
          </Link>
          <Link to="/login" className="rounded-xl border border-white/40 px-6 py-3 font-medium hover:bg-white/10">已有账号</Link>
        </div>
        <div className="mt-20 grid gap-5 md:grid-cols-3">
          {[
            { t: "聊天式配置", d: "像和顾问聊天一样完成客服搭建，AI 主动补齐缺口、生成技能文件并自动发布版本。" },
            { t: "生产级 API", d: "客服 ID + API Key 调用 /chat，完整 JSON 响应，支持排队状态查询与幂等重试。" },
            { t: "人工接管", d: "AI 拿不准就转人工：建议回复一键发送，或直接接管会话，随时交还 AI。" },
          ].map((f) => (
            <div key={f.t} className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur">
              <h3 className="mb-2 font-semibold">{f.t}</h3>
              <p className="text-sm leading-relaxed text-orange-50">{f.d}</p>
            </div>
          ))}
        </div>
        {admin && <p className="mt-10 text-sm text-orange-200">管理员会话已就绪，<Link className="underline" to="/admin">进入管理后台</Link></p>}
      </main>
    </div>
  );
}
