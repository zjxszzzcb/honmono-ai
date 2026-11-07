import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useAuth } from "../auth";
import { MerchantLayout } from "./layout";

type Svc = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  activeVersion: number | null;
  pendingHandoffs: number;
  activeKeys: number;
};

export function Dashboard() {
  return (
    <MerchantLayout active="dashboard">
      <DashboardInner />
    </MerchantLayout>
  );
}

function DashboardInner() {
  const [services, setServices] = useState<Svc[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Svc | null>(null);
  const { merchant } = useAuth();
  const nav = useNavigate();

  const load = useCallback(async () => {
    setServices(await api<Svc[]>("/api/customer-services"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const s = await api<{ id: string }>("/api/customer-services", { method: "POST", body: JSON.stringify({}) });
      nav(`/services/${s.id}/configure`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-slate-900">我的 AI 客服</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {merchant?.activated
              ? "管理你的客服 Agent：配置知识、联网能力、API 接入与人工接管。"
              : "创建客服前需要先兑换邀请码激活权益。"}
          </p>
        </div>
        <button className="btn-primary !rounded-xl whitespace-nowrap" onClick={merchant?.activated ? create : () => nav("/activate")} disabled={creating}>
          {creating ? "创建中…" : "＋ 创建客服"}
        </button>
      </div>

      {services.length === 0 ? (
        <div className="card flex flex-col items-center px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-2xl">🤖</div>
          <p className="mt-4 font-semibold text-slate-700">还没有客服 Agent</p>
          <p className="mt-1 max-w-sm text-sm text-slate-400">
            一键创建后，用一段话描述你的业务，或上传产品资料，几分钟就能得到一个可上线接入的客服。
          </p>
          <button className="btn-primary mt-6" onClick={merchant?.activated ? create : () => nav("/activate")}>
            {merchant?.activated ? "创建第一个客服" : "先去激活权益"}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {services.map((s) => (
            <ServiceCard key={s.id} svc={s} onEdit={() => setEditing(s)} onChanged={load} />
          ))}
        </div>
      )}

      {editing && <EditModal svc={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function ServiceCard({ svc, onEdit, onChanged }: { svc: Svc; onEdit: () => void; onChanged: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const nav = useNavigate();

  const STATUS: Record<string, [string, string]> = {
    configuring: ["配置中", "bg-amber-50 text-amber-600 border border-amber-200/70"],
    ready: ["可用", "bg-green-50 text-green-600 border border-green-200/70"],
    disabled: ["已停用", "bg-slate-100 text-slate-500 border border-slate-200"],
  };
  const [statusLabel, statusCls] = STATUS[svc.status] ?? [svc.status, ""];

  return (
    <div className="card group relative overflow-hidden p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF9500] to-[#FF5000] text-base font-bold text-white shadow-sm">
          {svc.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-slate-900">{svc.name}</h3>
            <span className={`badge ${statusCls}`}>{statusLabel}</span>
          </div>
          <p className={`mt-0.5 line-clamp-2 min-h-[2.4em] text-[13px] leading-relaxed ${svc.description ? "text-slate-500" : "text-slate-300"}`}>
            {svc.description || "还没有描述，点击右上角 ✎ 补充一段，方便团队其他成员理解这个客服的用途。"}
          </p>
        </div>
        <button
          className="rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
          title="编辑名称与描述"
          onClick={onEdit}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>
          {svc.activeVersion ? (
            <>
              运行版本 <span className="font-semibold text-[#FF5000]">v{svc.activeVersion}</span>
            </>
          ) : (
            "尚未发布"
          )}
        </span>
        <span className="text-slate-200">|</span>
        <span>创建于 {new Date(svc.createdAt).toLocaleDateString()}</span>
        {svc.pendingHandoffs > 0 && (
          <>
            <span className="text-slate-200">|</span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-600">
              {svc.pendingHandoffs} 个转人工待处理
            </span>
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <button className="btn-pill" onClick={() => nav(`/services/${svc.id}/configure`)}>
          配置
        </button>
        <button
          className="btn-pill"
          onClick={() => nav(`/services/${svc.id}/test`)}
          disabled={svc.status !== "ready"}
          title={svc.status === "ready" ? "测试台" : "发布后可用"}
        >
          测试
        </button>
        <button className="btn-pill btn-pill-danger ml-auto" onClick={() => setDeleting(true)}>
          删除
        </button>
      </div>
      {deleting && <DeleteModal svc={svc} onClose={() => setDeleting(false)} onDeleted={onChanged} />}
    </div>
  );
}

function EditModal({ svc, onClose, onSaved }: { svc: Svc; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(svc.name);
  const [description, setDescription] = useState(svc.description ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/customer-services/${svc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold text-slate-900">编辑客服信息</h3>
        <p className="mb-4 text-xs text-slate-400">这些信息仅供团队内部查看，不会影响客服的对话行为。</p>
        <label className="label">名称</label>
        <input className="input mb-3" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        <label className="label">描述（供团队查看）</label>
        <textarea
          className="input mb-4 min-h-[88px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="这个客服负责什么产品、面向什么用户、有哪些边界……"
        />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ svc, onClose, onDeleted }: { svc: Svc; onClose: () => void; onDeleted: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const matched = text.trim() === svc.name;

  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/api/customer-services/${svc.id}`, { method: "DELETE", body: JSON.stringify({ confirm_name: text.trim() }) });
      onDeleted();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-red-600">删除客服「{svc.name}」</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          此操作不可恢复：客服将立即下线，所有 API Key 一并失效，配置与对话数据将被归档。
        </p>
        <p className="mt-3 text-sm text-slate-600">
          请输入客服名称 <span className="font-semibold text-slate-900">{svc.name}</span> 确认：
        </p>
        <input className="input mt-1.5" value={text} onChange={(e) => setText(e.target.value)} placeholder={svc.name} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary !bg-[#e5484d] !shadow-none" onClick={doDelete} disabled={!matched || busy}>
            {busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
