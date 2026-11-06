import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../auth";
import { MerchantLayout } from "./layout";

type KeyRow = { id: string; name: string; prefix: string; revoked: boolean; last_used_at: string | null; created_at: string };

export function ApiKeys() {
  const { id } = useParams<{ id: string }>();
  return (
    <MerchantLayout>
      <KeysInner id={id!} />
    </MerchantLayout>
  );
}

function KeysInner({ id }: { id: string }) {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("默认 Key");
  const [created, setCreated] = useState<{ secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setKeys(await api<KeyRow[]>(`/api/customer-services/${id}/api-keys`));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const k = await api<{ secret: string }>(`/api/customer-services/${id}/api-keys`, { method: "POST", body: JSON.stringify({ name }) });
    setCreated(k);
    setCopied(false);
    load();
  };

  const revoke = async (keyId: string) => {
    if (!confirm("确定吊销该 Key？使用它的调用会立即 401。")) return;
    await api(`/api/customer-services/${id}/api-keys/${keyId}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">API Key</h1>
      <p className="mb-6 text-sm text-slate-500">Key 绑定单个客服，通过 <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code> 调用生产 /chat 接口。</p>

      <form onSubmit={createKey} className="card mb-6 flex items-end gap-3 p-5">
        <div className="flex-1">
          <label className="label">Key 名称</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button className="btn-primary">创建 Key</button>
      </form>

      {created && (
        <div className="card mb-6 border-blue-200 bg-blue-50 p-5">
          <h3 className="mb-2 font-semibold text-blue-800">Key 已创建，完整密钥只显示这一次：</h3>
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
          <p className="mt-2 text-xs text-blue-600">请立即保存到安全位置，刷新后无法再次查看。</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-3">名称</th>
              <th className="px-5 py-3">前缀</th>
              <th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">最后使用</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-slate-50">
                <td className="px-5 py-3 font-medium">{k.name}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{k.prefix}…</td>
                <td className="px-5 py-3">
                  {k.revoked ? <span className="badge bg-red-50 text-red-500">已吊销</span> : <span className="badge bg-green-50 text-green-600">有效</span>}
                </td>
                <td className="px-5 py-3 text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
                <td className="px-5 py-3 text-right">
                  {!k.revoked && <button className="btn-danger" onClick={() => revoke(k.id)}>吊销</button>}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">还没有创建 Key</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
