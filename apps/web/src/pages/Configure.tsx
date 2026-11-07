import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../auth";
import { MerchantLayout } from "./layout";
import { Composer } from "../components/Composer";
import { TypewriterText } from "../components/Typewriter";
import { Explorer } from "../components/Explorer";
import { LogoMark } from "../components/Logo";

type Msg = { id: number; role: string; author_type: string; content: string; created_at: string };
type ServiceDetail = {
  id: string;
  name: string;
  status: string;
  draft: { version: number; readiness: { blockers?: string[] } | null } | null;
  active: { version: number; publishedAt: string } | null;
};

type EditorTab = { path: string; content: string; saved: string; loading: boolean };
type AskUserPayload = { __honmono: "ask_user"; intro: string; questions: { question: string; options: string[] }[] };

function parseAskUser(content: string): AskUserPayload | null {
  if (!content.startsWith("{")) return null;
  try {
    const d = JSON.parse(content);
    if (d?.__honmono === "ask_user" && Array.isArray(d.questions) && d.questions.length > 0) return d;
    return null;
  } catch {
    return null;
  }
}

/** 结构化选择题卡片：点选 + 可选补充说明，提交后作为普通用户消息进入对话 */
function AskUserCard({
  payload,
  answered,
  onSubmit,
}: {
  payload: AskUserPayload;
  answered: boolean;
  onSubmit: (text: string) => void;
}) {
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState("");
  const allPicked = payload.questions.every((_, i) => picked[i]);

  const submit = () => {
    const lines = payload.questions.map((q, i) => `${i + 1}. ${q.question}：${picked[i] ?? ""}`);
    if (extra.trim()) lines.push(`补充：${extra.trim()}`);
    onSubmit(lines.join("\n"));
  };

  return (
    <div className="w-full max-w-[94%] rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50/90 to-amber-50/70 p-4">
      <p className="text-[13px] font-medium text-[#9a5b2d]">{payload.intro}</p>
      <div className="mt-3 space-y-3.5">
        {payload.questions.map((q, qi) => (
          <div key={qi}>
            <p className="mb-1.5 text-[13px] font-medium text-slate-700">
              {qi + 1}. {q.question}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const sel = picked[qi] === opt;
                return (
                  <button
                    key={opt}
                    disabled={answered}
                    onClick={() => setPicked((p) => ({ ...p, [qi]: opt }))}
                    className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                      sel
                        ? "border-[#FF5000] bg-[#FF5000] text-white shadow-sm"
                        : answered
                          ? "border-slate-200 bg-slate-50 text-slate-400"
                          : "border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-[#FF5000]"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {answered ? (
        <p className="mt-3 text-[11px] text-slate-400">已回答 ✓</p>
      ) : (
        <>
          <input
            className="input mt-3 !rounded-full text-[12.5px]"
            placeholder="其他补充说明（可留空）"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
          <button className="btn-primary mt-2.5 w-full !py-1.5 text-[12.5px]" onClick={submit} disabled={!allPicked}>
            {allPicked ? "提交回答" : "请先完成所有选择"}
          </button>
        </>
      )}
    </div>
  );
}

export function Configure() {
  const { id } = useParams<{ id: string }>();
  return (
    <MerchantLayout wide>
      <Workbench id={id!} />
    </MerchantLayout>
  );
}

function Workbench({ id }: { id: string }) {
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [run, setRun] = useState<{ id: string; state: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastServerIdRef = useRef(0);
  const [treeKey, setTreeKey] = useState(0);

  // 面板状态：null = 自动（agent 干活后自动展开）；手动开合后固定
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  // 编辑器状态
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

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
  // agent 已经开始工作（有 AI 回复或已发布过版本）
  const hasAgentActivity = Boolean(detail?.active) || messages.some((m) => m.role === "assistant" && m.author_type === "ai");
  const showFiles = panelOpen ?? hasAgentActivity;

  const chatPanel = (
    <div className={`card flex min-h-0 flex-col overflow-hidden ${showFiles ? "min-w-[420px] h-[calc(100vh-150px)]" : "mx-auto h-full w-full max-w-3xl"}`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2.5">
          {!showFiles && <LogoMark size={30} />}
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{detail?.name ?? "…"} · 配置助手</h2>
            {!showFiles && (
              <p className="mt-0.5 text-[11px] text-slate-400">描述你的公司和产品，或上传资料文件；助手会搭建客服技能并向你提问</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusChip detail={detail} />
          <button
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs ${
              showFiles ? "bg-orange-50 text-[#FF5000]" : "text-slate-500 hover:bg-slate-100"
            }`}
            title={showFiles ? "收起文件工作台" : "打开文件工作台"}
            onClick={() => setPanelOpen(!showFiles)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            文件
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!showFiles && messages.length === 0 && (
          <div className="flex flex-col items-center pt-10 pb-6 text-center">
            <LogoMark size={44} />
            <p className="mt-4 text-xl font-semibold text-slate-800">来搭建你的 AI 客服吧</p>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-400">
              描述你的公司和产品，或者上传产品手册、价格表、FAQ 等资料——助手会自动搭建客服技能、向你确认缺口，完成后自动发布上线。
            </p>
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === "user";
          const isSystem = m.role === "system";
          const askUser = !isUser && !isSystem ? parseAskUser(m.content) : null;
          const answered = isUser ? false : messages.some((x) => x.role === "user" && x.id > m.id);
          const animate = !isUser && !isSystem && !askUser && m.id === lastAssistantId;
          return (
            <div key={m.id} className={`msg-enter flex ${isUser ? "justify-end" : "justify-start"}`}>
              {askUser ? (
                <AskUserCard payload={askUser} answered={answered} onSubmit={send} />
              ) : (
                <div className={isUser ? "bubble-user" : isSystem ? "bubble-system" : "bubble-ai !text-[13px]"}>
                  {isUser ? m.content : <TypewriterText text={m.content} enabled={animate} />}
                </div>
              )}
            </div>
          );
        })}
        {busyRun && (
          <div className="msg-enter flex justify-start">
            <div className="bubble-ai flex items-center gap-1.5 !text-[13px] !text-slate-400">
              正在分析草稿与资料
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-1.5">
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
          {detail?.active && (
            <Link className="text-[#FF5000] hover:underline" to={`/services/${id}/test`}>
              去测试 →
            </Link>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 px-3 pb-3 pt-2.5">
        <Composer
          placeholder="向配置助手描述需求，Enter 发送"
          disabled={busyRun}
          onSend={send}
          attach={{ onFiles: upload, accept: ".md,.txt,.csv,.json,.pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.webp" }}
          attachLabel="上传资料"
        />
      </div>
    </div>
  );

  if (!showFiles) {
    return <div className="flex h-[calc(100vh-150px)]">{chatPanel}</div>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_240px_1fr]">
      {chatPanel}

      {/* ===== 资源管理器 ===== */}
      <div className="card h-[calc(100vh-150px)] min-w-0 overflow-hidden border-slate-200 bg-[#fbfbfc]">
        <Explorer serviceId={id} refreshKey={treeKey} activePath={activePath} onOpen={openFile} onUpload={upload} uploading={uploading} />
      </div>

      {/* ===== 编辑器 ===== */}
      <div className="card flex h-[calc(100vh-150px)] min-w-0 flex-col overflow-hidden">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 pt-1.5">
          {tabs.length === 0 && <span className="px-3 py-2 text-xs text-slate-400">未打开文件</span>}
          {tabs.map((t) => {
            const isDirty = t.content !== t.saved;
            const active = t.path === activePath;
            return (
              <div
                key={t.path}
                className={`flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs ${
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
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M9 13h6M9 17h6" />
            </svg>
            <p className="text-sm">点击中间文件列表开始编辑</p>
          </div>
        )}
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
