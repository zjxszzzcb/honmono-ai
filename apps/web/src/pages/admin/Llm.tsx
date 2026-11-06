import { useCallback, useEffect, useState } from "react";
import { api } from "../../auth";

type Provider = { id: string; name: string; type: string; base_url: string; api_key_mask: string; config_version: number; status: string };
type Model = { id: string; provider_id: string; provider_name: string | null; model_key: string; display_name: string; capabilities: { tool_call: boolean; vision: boolean; json: boolean; reasoning_summary: boolean }; status: string };
type Default = { scenario: string; model_id: string | null; model_key?: string; display_name?: string };

export function AdminLlm() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [defaults, setDefaults] = useState<Default[]>([]);
  const [msg, setMsg] = useState("");

  // 新建 provider 表单
  const [pName, setPName] = useState("");
  const [pType, setPType] = useState("anthropic");
  const [pBase, setPBase] = useState("");
  const [pKey, setPKey] = useState("");
  // 新建 model 表单
  const [mProvider, setMProvider] = useState("");
  const [mKey, setMKey] = useState("");
  const [mName, setMName] = useState("");

  const load = useCallback(async () => {
    setProviders(await api<Provider[]>("/api/admin/llm/providers"));
    setModels(await api<Model[]>("/api/admin/llm/models"));
    setDefaults([
      await api<Default>("/api/admin/llm/defaults/configuration"),
      await api<Default>("/api/admin/llm/defaults/runtime"),
    ]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 3000);
  };

  const createProvider = async () => {
    try {
      await api("/api/admin/llm/providers", { method: "POST", body: JSON.stringify({ name: pName, type: pType, base_url: pBase, api_key: pKey }) });
      setPName(""); setPBase(""); setPKey("");
      flash("Provider 已创建");
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "创建失败");
    }
  };

  const createModel = async () => {
    try {
      await api("/api/admin/llm/models", { method: "POST", body: JSON.stringify({ provider_id: mProvider, model_key: mKey, display_name: mName }) });
      setMKey(""); setMName("");
      flash("模型已添加");
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "创建失败");
    }
  };

  const testModel = async (id: string) => {
    flash("测试中…");
    const res = await api<{ ok: boolean; latency_ms?: number; sample?: string; error?: string }>(`/api/admin/llm/models/${id}/test`, { method: "POST" });
    flash(res.ok ? `连接正常（${res.latency_ms}ms）：${res.sample?.slice(0, 60)}` : `测试失败：${res.error}`);
  };

  const setDefault = async (scenario: string, modelId: string) => {
    await api(`/api/admin/llm/defaults/${scenario}`, { method: "PUT", body: JSON.stringify({ model_id: modelId }) });
    flash(`已设置 ${scenario === "configuration" ? "配置" : "运行时"}默认模型`);
    load();
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">LLM 配置</h1>
      {msg && <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>}

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">场景默认模型</h2>
          {defaults.map((d) => (
            <div key={d.scenario} className="mb-3">
              <label className="label">{d.scenario === "configuration" ? "配置 Agent" : "运行时 Agent"}</label>
              <select
                className="input"
                value={d.model_id ?? ""}
                onChange={(e) => setDefault(d.scenario, e.target.value)}
              >
                <option value="">未配置（将报错）</option>
                {models.filter((m) => m.status === "active").map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name}（{m.model_key}）</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-semibold">新增 Provider</h2>
          <label className="label">名称</label>
          <input className="input mb-2" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="如：本地网关" />
          <label className="label">类型</label>
          <select className="input mb-2" value={pType} onChange={(e) => setPType(e.target.value)}>
            <option value="anthropic">Anthropic 兼容（/v1/messages）</option>
            <option value="openai_compatible">OpenAI 兼容（/v1/chat/completions）</option>
          </select>
          <label className="label">Base URL</label>
          <input className="input mb-2" value={pBase} onChange={(e) => setPBase(e.target.value)} placeholder="http://host:4000" />
          <label className="label">API Key（仅入库时可见）</label>
          <input className="input mb-3" value={pKey} onChange={(e) => setPKey(e.target.value)} placeholder="sk-..." />
          <button className="btn-primary" onClick={createProvider} disabled={!pName || !pBase || !pKey}>创建 Provider</button>
        </div>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 font-semibold">Providers</div>
          <table className="w-full text-sm">
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium">{p.name} <span className="badge bg-slate-100 text-slate-500">{p.type}</span></p>
                    <p className="text-xs text-slate-400">{p.base_url} · Key {p.api_key_mask} · v{p.config_version}</p>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && <tr><td className="px-5 py-6 text-center text-slate-400">暂无</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-semibold">新增模型</h2>
          <label className="label">Provider</label>
          <select className="input mb-2" value={mProvider} onChange={(e) => setMProvider(e.target.value)}>
            <option value="">选择…</option>
            {providers.filter((p) => p.status === "active").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="label">模型 ID</label>
          <input className="input mb-2" value={mKey} onChange={(e) => setMKey(e.target.value)} placeholder="deepseek-v4.1-flash" />
          <label className="label">显示名</label>
          <input className="input mb-3" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="DeepSeek V4.1 Flash" />
          <button className="btn-primary" onClick={createModel} disabled={!mProvider || !mKey || !mName}>添加模型</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 font-semibold">模型列表</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-3">显示名</th><th className="px-5 py-3">模型 ID</th><th className="px-5 py-3">Provider</th><th className="px-5 py-3">能力</th><th className="px-5 py-3">状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-b border-slate-50">
                <td className="px-5 py-3 font-medium">{m.display_name}</td>
                <td className="px-5 py-3 font-mono text-xs">{m.model_key}</td>
                <td className="px-5 py-3 text-slate-500">{m.provider_name}</td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  {[m.capabilities?.tool_call && "工具", m.capabilities?.vision && "视觉", m.capabilities?.json && "JSON", m.capabilities?.reasoning_summary && "推理摘要"].filter(Boolean).join(" / ") || "—"}
                </td>
                <td className="px-5 py-3">{m.status === "active" ? <span className="badge bg-green-50 text-green-600">启用</span> : <span className="badge bg-slate-100 text-slate-500">停用</span>}</td>
                <td className="px-5 py-3 text-right">
                  <button className="btn-ghost" onClick={() => testModel(m.id)}>测试连接</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
