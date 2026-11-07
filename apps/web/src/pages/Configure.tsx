import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../auth";
import { MerchantLayout } from "./layout";
import { Composer } from "../components/Composer";
import { TypewriterText } from "../components/Typewriter";
import { Explorer } from "../components/Explorer";

type Msg = { id: number; role: string; author_type: string; content: string; created_at: string };
type ServiceDetail = {
  id: string;
  name: string;
  status: string;
  draft: { version: number; readiness: { blockers?: string[] } | null } | null;
  active: { version: number; publishedAt: string } | null;
};

type EditorTab = { path: string; content: string; saved: string; loading: boolean };

export function Configure() {
  const { id } = useParams<{ id: string }>();
  return (
    <MerchantLayout wide>
      <Workbench id={id!} />
    </MerchantLayout>
  );
}

const UPLOAD_HINT = "直接描述你的公司和产品即可，也可以上传资料文件。图片暂不做 OCR。";

function Workbench({ id }: { id: string }) {
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [run, setRun] = useState<{ id: string; state: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastServerIdRef = useRef(0);
  const [treeKey, setTreeKey] = useState(0);

  // 编辑器状态
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [showGuidesNote, setShowGuidesNote] = useState(true);

  const refresh = useCallback(async () => {
    const d = await api<ServiceDetail>(`/api/customer-services/${id}`);
    setDetail(d);
    const conv = await api<{ messages: Msg[]; run: { id: string; state: string } | null }>(
      `/api/customer-services/${id}/config/messages`,
    );
    setMessages(conv.messages);
    setRun(conv.run);
    if (conv.messages.length) lastServerIdRef.current = conv.messages.at(-1)!.id;
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!run?.state || ["succeeded", "failed", "superseded"].includes(run.state)) return;
    const t = setInterval(async () => {
      try {
        const conv = await api<{ messages: Msg[]; run: { id: string; state: string } | null }>(
          `/api/customer-services/${id}/config/messages?after=${lastServerIdRef.current}`,
        );
        const fresh = conv.messages.filter((m) => m.id > lastServerIdRef.current);
        if (fresh.length > 0) {
          setMessages((prev) => [...prev, ...fresh]);
          lastServerIdRef.current = Math.max(lastServerIdRef.current, ...fresh.map((m) => m.id));
          setTreeKey((k) => k + 1);
        }
        setRun(conv.run);
        if (conv.run === null) {
          clearInterval(t);
          refresh();
          setTreeKey((k) => k + 1);
        }
      } catch {
        /* 轮询失败下次重试 */
      }
    }, 1600);
    return () => clearInterval(t);
  }, [run?.state, id, refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, run?.state]);

  const send = async (content: string) => {
    try {
      await api<{ run_id: string }>(`/api/customer-services/${id}/config/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "发送失败");
    }
  };

  const upload = async (list: FileList) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of Array.from(list)) form.append("files", f);
      const res = await fetch(`/api/customer-services/${id}/files`, { method: "POST", body: form, credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert((body as { message?: string }).message ?? "上传失败");
      }
      setTreeKey((k) => k + 1);
    } finally {
      setUploading(false);
    }
  };

  // ============ 编辑器 ============
  const openFile = async (path: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActivePath(path);
      return;
    }
    setTabs((prev) => [...prev, { path, content: "", saved: "", loading: true }]);
    setActivePath(path);
    try {
      const p = await api<{ path: string; content: string }>(
        `/api/customer-services/${id}/files/preview?path=${encodeURIComponent(path)}`,
      );
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, content: p.content, saved: p.content, loading: false } : t)));
    } catch (err) {
      setTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, content: `# 读取失败\n\n${err instanceof Error ? err.message : "未知错误"}`, saved: "", loading: false } : t)),
      );
    }
  };

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;
  const dirty = activeTab ? activeTab.content !== activeTab.saved : false;

  const updateContent = (content: string) => {
    setTabs((prev) => prev.map((t) => (t.path === activePath ? { ...t, content } : t)));
  };

  const saveFile = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab || tab.loading || tab.content === tab.saved) return;
    setSaving(true);
    try {
      await api(`/api/customer-services/${id}/files/content`, {
        method: "PUT",
        body: JSON.stringify({ path: tab.path, content: tab.content }),
      });
      setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, saved: t.content } : t)));
      setSavedFlash(`${tab.path.split("/").pop()} 已保存`);
      setTimeout(() => setSavedFlash(null), 2200);
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [tabs, activePath, id]);

  // Cmd/Ctrl+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) saveFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saveFile]);

  const closeTab = (path: string) => {
    setTabs((prev) => prev.filter((t) => t.path !== path));
    if (activePath === path) {
      const rest = tabs.filter((t) => t.path !== path);
      setActivePath(rest.length ? rest.at(-1)!.path : null);
    }
  };

  const busyRun = Boolean(run?.state && !["succeeded", "failed", "superseded"].includes(run.state));
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className="grid gap-4 xl:grid-cols-[240px_1fr_400px]">
      {/* ===== 资源管理器 ===== */}
      <div className="card h-[calc(100vh-150px)] overflow-hidden border-slate-200 bg-[#fbfbfc]">
        <Explorer serviceId={id} refreshKey={treeKey} activePath={activePath} onOpen={openFile} onUpload={upload} uploading={uploading} />
      </div>

      {/* ===== 编辑器 ===== */}
      <div className="card flex h-[calc(100vh-150px)] min-w-0 flex-col overflow-hidden">
        {/* tab 栏 */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-1.5">
          {tabs.length === 0 && <span className="px-3 py-2 text-xs text-slate-400">未打开文件</span>}
          {tabs.map((t) => {
            const isDirty = t.content !== t.saved;
            const active = t.path === activePath;
            return (
              <div
                key={t.path}
                className={`group flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs ${
                  active ? "border-slate-200 bg-white text-slate-800" : "border-transparent text-slate-500 hover:bg-slate-100"
                }`}
              >
                <button className="max-w-[200px] truncate font-mono" onClick={() => setActivePath(t.path)} title={t.path}>
                  {t.path.split("/").pop()}
                  {isDirty ? " ●" : ""}
                </button>
                <button className="text-slate-300 hover:text-slate-600" onClick={() => closeTab(t.path)}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        {activeTab ? (
          <>
            <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-2">
              <span className="truncate font-mono text-xs text-slate-500">{activeTab.path}</span>
              <div className="flex items-center gap-2">
                {savedFlash && <span className="text-xs text-green-600">{savedFlash}</span>}
                {dirty && <span className="text-xs text-amber-600">未保存</span>}
                <button className="btn-primary !px-3 !py-1 text-xs" onClick={saveFile} disabled={!dirty || saving || activeTab.loading}>
                  {saving ? "保存中…" : "保存 ⌘S"}
                </button>
              </div>
            </div>
            {activeTab.loading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">加载中…</div>
            ) : (
              <textarea
                className="min-h-0 flex-1 resize-none bg-[#fbfbfc] p-4 font-mono text-[12.5px] leading-relaxed text-slate-700 outline-none"
                value={activeTab.content}
                onChange={(e) => updateContent(e.target.value)}
                spellCheck={false}
              />
            )}
            <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-1.5 text-[11px] text-slate-400">
              <span>Markdown · UTF-8</span>
              <span>{dirty ? "有未保存修改" : "已同步"}</span>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-300">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M9 13h6M9 17h6" />
            </svg>
            <p className="text-sm">点击左侧文件开始编辑</p>
            <p className="text-xs">修改 SKILL.md 或 references 后，可在右侧让配置助手核对并发布新版本</p>
          </div>
        )}
      </div>

      {/* ===== 配置聊天 ===== */}
      <div className="card flex h-[calc(100vh-150px)] flex-col overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-slate-900">{detail?.name ?? "…"} · 配置助手</h2>
            <StatusChip detail={detail} />
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{UPLOAD_HINT}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="msg-enter flex justify-start">
            <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-[#8a5a2e]">
              👋 描述你要做的客服，或上传资料（自动存入 <code className="rounded bg-white/70 px-1 font-mono text-[11px]">assets/raw/</code>）。我会阅读后向你提问，文件改动我可以核对并发布。
            </div>
          </div>
          {messages.map((m) => {
            const isUser = m.role === "user";
            const isSystem = m.role === "system";
            const animate = !isUser && !isSystem && m.id === lastAssistantId;
            return (
              <div key={m.id} className={`msg-enter flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className={isUser ? "bubble-user !max-w-[92%]" : isSystem ? "bubble-system" : "bubble-ai !max-w-[94%] !text-[13px]"}>
                  {isUser ? m.content : <TypewriterText text={m.content} enabled={animate} />}
                </div>
              </div>
            );
          })}
          {busyRun && (
            <div className="msg-enter flex justify-start">
              <div className="bubble-ai flex items-center gap-1.5 !max-w-[94%] !text-[13px] !text-slate-400">
                正在分析草稿与资料
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 状态条 */}
        <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2">
          <div className="flex items-center justify-between text-[11px]">
            <span>
              {detail?.active ? (
                <>
                  <span className="font-semibold text-[#FF5000]">v{detail.active.version}</span> 运行中
                  {detail.draft?.readiness?.blockers && detail.draft.readiness.blockers.length > 0 ? (
                    <span className="text-amber-600"> · 草稿有 {detail.draft.readiness.blockers.length} 项待补齐</span>
                  ) : (
                    <span className="text-slate-400"> · 草稿就绪</span>
                  )}
                </>
              ) : (
                <span className="text-slate-400">尚未发布 · 补齐关键信息后自动发布</span>
              )}
            </span>
            <Link className="text-[#FF5000] hover:underline" to={`/services/${id}/test`}>
              去测试 →
            </Link>
          </div>
          {detail?.draft?.readiness?.blockers && detail.draft.readiness.blockers.length > 0 && showGuidesNote && (
            <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-700">
              {detail.draft.readiness.blockers.slice(0, 2).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-100 px-3 pb-3 pt-2.5">
          <Composer
            placeholder="向配置助手描述需求…"
            disabled={busyRun}
            onSend={send}
            sendLabel="Enter 发送"
          />
        </div>
      </div>
    </div>
  );
}

function StatusChip({ detail }: { detail: ServiceDetail | null }) {
  if (!detail) return null;
  const map: Record<string, [string, string]> = {
    configuring: ["配置中", "bg-amber-100 text-amber-700"],
    ready: ["可用", "bg-green-100 text-green-700"],
    disabled: ["已停用", "bg-slate-200 text-slate-500"],
  };
  const [label, cls] = map[detail.status] ?? [detail.status, "bg-slate-100"];
  return <span className={`badge ${cls}`}>{label}</span>;
}
