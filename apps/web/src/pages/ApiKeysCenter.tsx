import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../auth";
import { MerchantLayout } from "./layout";

type KeyRow = {
  id: string;
  service_id: string;
  service_name: string;
  service_status: string;
  name: string;
  prefix: string;
  revoked: boolean;
  last_used_at: string | null;
  created_at: string;
};
type Svc = { id: string; name: string; status: string };

/** 全局 API Key 管理看板 */
export function ApiKeysCenter() {
  return (
    <MerchantLayout active="keys">
      <Center />
    </MerchantLayout>
  );
}

/** API 文档视图 */
function ApiDocs({ services }: { services: Svc[] }) {
  const [svcId, setSvcId] = useState(services[0]?.id ?? "");
  const svc = services.find((s) => s.id === svcId) ?? services[0];
  const base = `${location.origin}`;
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">快速开始</h3>
          <select className="input !w-auto !py-1 text-xs" value={svc?.id ?? ""} onChange={(e) => setSvcId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-slate-600">
          1. 在上方「密钥管理」为客服创建一个 Key；2. 以 <code className="rounded bg-slate-100 px-1.5">Authorization: Bearer sk…</code> 调用下面的接口；3.
          收到完整 JSON 响应（非流式）；4. 转人工后用消息增量接口拉取人工回复。
        </p>
        <p className="mb-1.5 text-xs font-semibold text-slate-500">发起对话</p>
        <CodeBlock
          title={`POST ${base}/v1/customer-services/${svc?.id ?? "<serviceId>"}/chat`}
          code={`curl -X POST "${base}/v1/customer-services/${svc?.id ?? "<serviceId>"}/chat" \
  -H "Authorization: Bearer <你的sk密钥>" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "<每次请求生成一个UUID，重试时复用可防重复>",
    "conversation_id": "your-player-123",
    "messages": [
      { "role": "user", "content": "我想了解一下退款政策" }
    ],
    "metadata": { "end_user_id": "optional-user-id" }
  }'`}
        />
        <p className="mb-1.5 mt-4 text-xs font-semibold text-slate-500">成功响应（status=completed）</p>
        <CodeBlock
          title="200 OK"
          code={`{
  "request_id": "04524bd7-…",
  "conversation_id": "your-player-123",
  "status": "completed",
  "message": { "role": "assistant", "content": "签收后 7 天内…" },
  "run": { "skill_version": 1, "trace_id": "…", "started_at": "…", "finished_at": "…" }
}`}
        />
        <p className="mb-1.5 mt-4 text-xs font-semibold text-slate-500">拉取人工回复（收到 waiting_for_human / human_controlled 后轮询）</p>
        <CodeBlock
          title={`GET ${base}/v1/customer-services/${svc?.id ?? "<serviceId>"}/conversations/your-player-123/messages?after=0`}
          code={`curl "${base}/v1/customer-services/${svc?.id ?? "<serviceId>"}/conversations/your-player-123/messages?after=<已读到的消息ID>" \
  -H "Authorization: Bearer <你的sk密钥>"`}
        />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 font-semibold">status 终态说明</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">含义</th>
                <th className="px-3 py-2">调用方处理</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["completed", "正常生成并持久化回复", "展示 message.content"],
                ["waiting_for_human", "AI 已转人工，含 handoff_id", "轮询消息接口等人工回复"],
                ["human_controlled", "人工接管中，消息已收到", "不期待 AI 回复，继续轮询"],
                ["superseded", "等待补充时被新消息取代", "丢弃旧结果，以新请求为准"],
                ["agent_failed", "运行失败（响应含 detail/trace_id）", "可更换 request_id 重试"],
                ["service_not_ready (409)", "客服尚未发布", "先在配置页完成发布"],
                ["queue_full (429)", "队列满，请求未被接受", "按 retry_after 延迟重试"],
              ].map(([a, b, cc]) => (
                <tr key={a} className="border-b border-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{a}</td>
                  <td className="px-3 py-2 text-slate-600">{b}</td>
                  <td className="px-3 py-2 text-slate-500">{cc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-2 font-semibold">约定与注意</h3>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li><code className="rounded bg-slate-100 px-1">request_id</code> 由调用方生成（UUID），同客服下唯一并充当幂等键：同 id 重试不会重复追加消息。</li>
          <li><code className="rounded bg-slate-100 px-1">messages</code> 只传本次新增消息；服务端按 conversation_id 保存并组装完整历史。</li>
          <li>只接受 role=user 消息；assistant/system 内容由服务端管理。</li>
          <li>AI 转人工后（waiting_for_human），轮询消息接口即可看到 <code className="rounded bg-slate-100 px-1">author_type=human</code> 的人工回复。</li>
          <li>所有响应为完整 JSON，不推送流式 Token；长对话建议客户端超时 ≥ 60s。</li>
        </ul>
      </div>
    </div>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#0f172a]">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2">
        <span className="font-mono text-[11px] text-slate-400">{title}</span>
        <button
          className="rounded-md px-2 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-white"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[12px] leading-relaxed text-[#d6e2f0]">{code}</pre>
    </div>
  );
}

function Center() {
  const [tab, setTab] = useState<"keys" | "docs">("keys");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [keyName, setKeyName] = useState("默认 Key");
  const [created, setCreated] = useState<{ secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setKeys(await api<KeyRow[]>("/api/api-keys"));
    setServices(await api<Svc[]>("/api/customer-services"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createKey = async () => {
    const k = await api<{ secret: string }>(`/api/customer-services/${serviceId}/api-keys`, {
      method: "POST",
      body: JSON.stringify({ name: keyName }),
    });
    setCreated(k);
    setCopied(false);
    setShowCreate(false);
    load();
  };

  const revoke = async (serviceIdOfKey: string, keyId: string) => {
    if (!confirm("确定删除该 Key？使用它的调用会立即失效（401）。")) return;
    await api(`/api/customer-services/${serviceIdOfKey}/api-keys/${keyId}`, { method: "DELETE" });
    load();
  };

  const active = keys.filter((k) => !k.revoked);
  const revoked = keys.filter((k) => k.revoked);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">API</h1>
          <p className="mt-1 text-sm text-slate-500">接入生产对话接口：管理密钥、查阅调用文档。</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {(
            [
              ["keys", "密钥管理"],
              ["docs", "API 文档"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3.5 py-1.5 text-sm ${tab === k ? "bg-[#FF5000] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "docs" ? <ApiDocs services={services} /> : (
      <>

      {showCreate && (
        <div className="card mb-6 p-5">
          <h3 className="mb-3 font-semibold">创建 Key</h3>
          <label className="label">所属客服</label>
          <select className="input mb-3" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">选择客服…</option>
            {services
              .filter((s) => s.status !== "disabled")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <label className="label">Key 名称</label>
          <input className="input mb-4" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={createKey} disabled={!serviceId}>
              创建
            </button>
            <button className="btn-ghost" onClick={() => setShowCreate(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {created && (
        <div className="card mb-6 border-orange-200 bg-orange-50 p-5">
          <h3 className="mb-2 font-semibold text-[#c2410c]">Key 已创建，完整密钥只显示这一次：</h3>
          <div className="flex items-center gap-3">
            <code className="flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm">{created.secret}</code>
            <button
              className="btn-ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(created.secret);
                setCopied(true);
              }}
            >
              {copied ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <p className="mt-2 text-xs text-orange-600">请立即保存到安全位置，刷新后无法再次查看。</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 font-semibold">
          有效 Key <span className="ml-1 text-sm font-normal text-slate-400">{active.length}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-3">名称</th>
              <th className="px-5 py-3">所属客服</th>
              <th className="px-5 py-3">前缀</th>
              <th className="px-5 py-3">最后使用</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {active.map((k) => (
              <tr key={k.id} className="border-b border-slate-50">
                <td className="px-5 py-3 font-medium">{k.name}</td>
                <td className="px-5 py-3">
                  <Link className="text-[#FF5000] hover:underline" to={`/services/${k.service_id}/configure`}>
                    {k.service_name}
                  </Link>
                </td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{k.prefix}…</td>
                <td className="px-5 py-3 text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
                <td className="px-5 py-3 text-right">
                  <button className="btn-danger" onClick={() => revoke(k.service_id, k.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                  还没有有效 Key
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {revoked.length > 0 && (
        <div className="card mt-6 overflow-hidden opacity-70">
          <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-500">已删除</div>
          <table className="w-full text-sm">
            <tbody>
              {revoked.map((k) => (
                <tr key={k.id} className="border-b border-slate-50">
                  <td className="px-5 py-2.5">{k.name}</td>
                  <td className="px-5 py-2.5 text-slate-500">{k.service_name}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{k.prefix}…</td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="badge bg-slate-100 text-slate-500">已删除</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  );
}
