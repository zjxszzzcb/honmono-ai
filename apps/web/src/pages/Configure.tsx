import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../auth";
import { MerchantLayout } from "./layout";
import { Composer } from "../components/Composer";
import { TypewriterText } from "../components/Typewriter";
import { FileTree } from "../components/FileTree";

type Msg = { id: number; role: string; author_type: string; content: string; created_at: string };
type FileRow = { id: string; name: string; size: number; parse_status: string; parse_report: Record<string, unknown> | null };
type ServiceDetail = {
  id: string;
  name: string;
  status: string;
  draft: { version: number; readiness: { blockers?: string[] } | null } | null;
  active: { version: number; publishedAt: string } | null;
};

export function Configure() {
  const { id } = useParams<{ id: string }>();
  return (
    <MerchantLayout>
      <ConfigureInner id={id!} />
    </MerchantLayout>
  );
}

const UPLOAD_HINT = "直接描述你的公司和产品即可。也可以上传产品手册、价格表、FAQ、售后政策等文件；支持多文件。图片暂不做 OCR，多模态模型可直接读取支持的图片。";

function ConfigureInner({ id }: { id: string }) {
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [run, setRun] = useState<{ id: string; state: string | null } | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastServerIdRef = useRef(0);
  const [treeKey, setTreeKey] = useState(0);

  /** 全量刷新（服务端为唯一事实源，彻底避免本地乐观插入与服务端 id 不一致导致的重复） */
  const refresh = useCallback(async () => {
    const d = await api<ServiceDetail>(`/api/customer-services/${id}`);
    setDetail(d);
    const conv = await api<{ messages: Msg[]; run: { id: string; state: string } | null }>(
      `/api/customer-services/${id}/config/messages`,
    );
    setMessages(conv.messages);
    setRun(conv.run);
    if (conv.messages.length) lastServerIdRef.current = conv.messages.at(-1)!.id;
    setFiles(await api<FileRow[]>(`/api/customer-services/${id}/files`));
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 有活动 Run 时轮询：只增量合并服务端消息（id 一定大于已记录的服务端最大 id）
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
          refresh(); // 终态：全量对齐一次（readiness/文件状态）
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
      await refresh(); // POST 返回即已包含新消息，立即对齐
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
      await refresh();
      setTreeKey((k) => k + 1);
    } finally {
      setUploading(false);
    }
  };

  const busyRun = Boolean(run?.state && !["succeeded", "failed", "superseded"].includes(run.state));
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="card flex h-[calc(100vh-150px)] flex-col overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-semibold text-slate-900">{detail?.name ?? "…"} · 配置</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{UPLOAD_HINT}</p>
            </div>
            <StatusChip detail={detail} />
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="msg-enter flex justify-start">
            <div className="max-w-[86%] rounded-2xl rounded-bl-md border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 px-4 py-3 text-sm leading-relaxed text-[#8a5a2e]">
              👋 欢迎使用配置向导。请描述你要做的客服：产品/业务是什么、希望客服负责什么。也可以先上传资料文件，我会阅读后再向你提问。
            </div>
          </div>
          {messages.map((m) => {
            const isUser = m.role === "user";
            const isSystem = m.role === "system";
            const animate = !isUser && !isSystem && m.id === lastAssistantId;
            return (
              <div key={m.id} className={`msg-enter flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className={isUser ? "bubble-user" : isSystem ? "bubble-system" : "bubble-ai"}>
                  {isUser ? m.content : <TypewriterText text={m.content} enabled={animate} />}
                </div>
              </div>
            );
          })}
          {busyRun && (
            <div className="msg-enter flex justify-start">
              <div className="bubble-ai flex items-center gap-1.5 !text-slate-400">
                配置助手正在分析草稿与资料
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <Composer
            placeholder="输入配置信息，Enter 发送，Shift+Enter 换行"
            disabled={busyRun}
            onSend={send}
            attach={{
              onFiles: upload,
              accept: ".md,.txt,.csv,.json,.pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.webp",
            }}
            attachLabel="上传资料"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">状态</h3>
            {detail?.active && <span className="badge badge-brand">v{detail.active.version} 已发布</span>}
          </div>
          {detail?.active ? (
            <p className="text-sm text-slate-600">
              ✅ 客服可用，当前运行 <span className="font-semibold text-[#FF5000]">v{detail.active.version}</span>
              ，继续补充资料会自动发布新版本。
            </p>
          ) : (
            <p className="text-sm text-slate-500">尚未发布可用版本，按助手引导补齐关键信息即可自动发布。</p>
          )}
          {detail?.draft?.readiness?.blockers && detail.draft.readiness.blockers.length > 0 && (
            <div className="mt-3 rounded-xl bg-amber-50/70 p-3 text-xs text-amber-800">
              <p className="mb-1 font-medium">待补齐：</p>
              <ul className="list-disc pl-4">
                {detail.draft.readiness.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          <Link className="btn-primary mt-4 w-full" to={`/services/${id}/test`}>
            去测试台体验 →
          </Link>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">资料文件</h3>
            <span className="text-xs text-slate-400">{uploading ? "上传中…" : `${files.length} 个`}</span>
          </div>
          {files.length === 0 && <p className="text-xs text-slate-400">还没有上传文件，点输入框左侧 ＋ 上传</p>}
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                <span className="max-w-[62%] truncate text-[13px] text-slate-700" title={f.name}>
                  📎 {f.name}
                </span>
                <ParseBadge status={f.parse_status} />
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Skill 工作目录</h3>
            <span className="badge badge-brand">drafts</span>
          </div>
          <p className="mb-2 text-xs text-slate-400">配置助手实时写入的技能文件，点击可预览内容</p>
          <FileTree serviceId={id} refreshKey={treeKey} />
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

function ParseBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending: ["等待解析", "bg-slate-100 text-slate-500"],
    parsing: ["解析中", "bg-blue-50 text-blue-600"],
    parsed: ["已解析", "bg-green-50 text-green-600"],
    partial: ["部分解析", "bg-amber-50 text-amber-600"],
    unsupported: ["不支持", "bg-slate-100 text-slate-400"],
    failed: ["失败", "bg-red-50 text-red-500"],
  };
  const [label, cls] = map[status] ?? [status, "bg-slate-100"];
  return <span className={`badge ${cls}`}>{label}</span>;
}
