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

function Center() {
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
    if (!confirm("确定吊销该 Key？使用它的调用会立即 401。")) return;
    await api(`/api/customer-services/${serviceIdOfKey}/api-keys/${keyId}`, { method: "DELETE" });
    load();
  };

  const active = keys.filter((k) => !k.revoked);
  const revoked = keys.filter((k) => k.revoked);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="mt-1 text-sm text-slate-500">
            以 <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code> 调用
            生产 /chat 接口。Key 绑定单个客服，完整值仅创建时显示一次。
          </p>
        </div>
        <button className="btn-primary whitespace-nowrap" onClick={() => setShowCreate(true)}>
          + 创建 Key
        </button>
      </div>

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
                    吊销
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
          <div className="border-b border-slate-100 px-5 py-3 font-semibold text-slate-500">已吊销</div>
          <table className="w-full text-sm">
            <tbody>
              {revoked.map((k) => (
                <tr key={k.id} className="border-b border-slate-50">
                  <td className="px-5 py-2.5">{k.name}</td>
                  <td className="px-5 py-2.5 text-slate-500">{k.service_name}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-400">{k.prefix}…</td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="badge bg-slate-100 text-slate-500">已吊销</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
