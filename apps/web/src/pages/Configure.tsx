import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../auth";
import { MerchantLayout } from "./layout";

type Msg = { id: number; role: string; author_type: string; content: string; created_at: string };
type FileRow = { id: string; name: string; size: number; parse_status: string; parse_report: Record<string, unknown> | null };
type ServiceDetail = {
  id: string;
  name: string;
  status: string;
  draft: { version: number; readiness: { blockers?: string[]; readiness?: Record<string, Record<string, string>> } | null } | null;
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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);

  const load = useCallback(async () => {
    const d = await api<ServiceDetail>(`/api/customer-services/${id}`);
    setDetail(d);
    const conv = await api<{ messages: Msg[]; run: { id: string; state: string } | null }>(`/api/customer-services/${id}/config/messages`);
    setMessages(conv.messages);
    setRun(conv.run);
    setFiles(await api<FileRow[]>(`/api/customer-services/${id}/files`));
    if (conv.messages.length) lastIdRef.current = conv.messages.at(-1)!.id;
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // 有活动 Run 时轮询
  useEffect(() => {
    if (!run?.state || ["succeeded", "failed", "superseded"].includes(run.state)) return;
    const t = setInterval(async () => {
      const conv = await api<{ messages: Msg[]; run: { id: string; state: string } | null }>(`/api/customer-services/${id}/config/messages?after=${lastIdRef.current}`);
      if (conv.messages.length) {
        setMessages((prev) => [...prev, ...conv.messages.filter((m) => !prev.some((p) => p.id === m.id))]);
        lastIdRef.current = Math.max(lastIdRef.current, ...conv.messages.map((m) => m.id));
      }
      setRun(conv.run);
      if (conv.run === null) {
        clearInterval(t);
        load();
      }
    }, 1500);
    return () => clearInterval(t);
  }, [run?.state, id, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, run?.state]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || run?.state && !["succeeded", "failed", "superseded"].includes(run.state)) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    try {
      const r = await api<{ run_id: string }>(`/api/customer-services/${id}/config/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setMessages((prev) => [...prev, { id: Date.now(), role: "user", author_type: "merchant", content, created_at: new Date().toISOString() }]);
      setRun({ id: r.run_id, state: "queued" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const form = new FormData();
    for (const f of Array.from(list)) form.append("files", f);
    const res = await fetch(`/api/customer-services/${id}/files`, { method: "POST", body: form, credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert((body as { message?: string }).message ?? "上传失败");
    }
    e.target.value = "";
    load();
  };

  const busyRun = Boolean(run && run.state && !["succeeded", "failed", "superseded"].includes(run.state));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="card flex h-[calc(100vh-190px)] flex-col">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">{detail?.name ?? "…"} · 配置</h2>
              <p className="mt-0.5 text-xs text-slate-400">{UPLOAD_HINT}</p>
            </div>
            <StatusChip detail={detail} />
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
            👋 欢迎使用配置向导。请描述你要做的客服：产品/业务是什么、希望客服负责什么。也可以先上传资料文件，我会阅读后再向你提问。
          </div>
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-blue-600 text-white"
                    : m.author_type === "system"
                      ? "rounded-bl-md border border-amber-200 bg-amber-50 text-amber-800"
                      : "rounded-bl-md bg-slate-100 text-slate-800"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {busyRun && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-2.5 text-sm text-slate-400">
                <span className="animate-pulse">配置助手正在分析草稿与资料…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-slate-100 px-5 py-3.5">
          <input className="input flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入配置信息，回车发送" disabled={!!busyRun || sending} />
          <button className="btn-primary" disabled={!!busyRun || sending || !input.trim()}>发送</button>
        </form>
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <h3 className="mb-3 font-semibold">状态</h3>
          {detail?.active ? (
            <p className="text-sm text-green-700">✅ 已发布 v{detail.active.version}，客服可用</p>
          ) : (
            <p className="text-sm text-slate-500">尚未发布可用版本</p>
          )}
          {detail?.draft?.readiness?.blockers && detail.draft.readiness.blockers.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <p className="mb-1 font-medium">待补齐：</p>
              <ul className="list-disc pl-4">
                {detail.draft.readiness.blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-4 flex gap-2 text-sm">
            <Link className="btn-ghost flex-1" to={`/services/${id}/test`}>去测试</Link>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">资料文件</h3>
            <label className="btn-ghost cursor-pointer text-xs">
              上传
              <input type="file" multiple className="hidden" onChange={upload} accept=".md,.txt,.csv,.json,.pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.webp" />
            </label>
          </div>
          {files.length === 0 && <p className="text-xs text-slate-400">还没有上传文件</p>}
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <span className="max-w-[60%] truncate" title={f.name}>{f.name}</span>
                <ParseBadge status={f.parse_status} />
              </li>
            ))}
          </ul>
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
