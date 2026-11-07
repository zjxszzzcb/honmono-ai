import { useCallback, useEffect, useState } from "react";
import { api } from "../../auth";

type Provider = { id: string; name: string; type: string; base_url: string; api_key_mask: string; config_version: number; status: string };
type Model = {
  id: string;
  provider_id: string;
  provider_name: string | null;
  model_key: string;
  display_name: string;
  capabilities: { tool_call: boolean; vision: boolean; json: boolean; reasoning_summary: boolean };
  status: string;
};
type Default = { scenario: string; model_id: string | null; model_key?: string; display_name?: string };
type SearchProvider = {
  id: string;
  name: string;
  type: string;
  api_key_mask: string;
  status: string;
  quota_remaining: number | null;
  last_status: string | null;
  last_error: string | null;
  last_used_at: string | null;
  last_checked_at: string | null;
  created_at: string;
};

export function AdminLlm() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [defaults, setDefaults] = useState<Default[]>([]);
  const [msg, setMsg] = useState("");

  // LLM provider 表单
  const [pName, setPName] = useState("");
  const [pType, setPType] = useState("anthropic");
  const [pBase, setPBase] = useState("");
  const [pKey, setPKey] = useState("");
  // LLM model 表单
  const [mProvider, setMProvider] = useState("");
  const [mKey, setMKey] = useState("");
  const [mName, setMName] = useState("");
  // 搜索服务
  const [spList, setSpList] = useState<SearchProvider[]>([]);
  const [spName, setSpName] = useState("");
  const [spType, setSpType] = useState("exa");
  const [spKey, setSpKey] = useState("");
  const [spTesting, setSpTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProviders(await api<Provider[]>("/api/admin/llm/providers"));
    setModels(await api<Model[]>("/api/admin/llm/models"));
    setDefaults([
      await api<Default>("/api/admin/llm/defaults/configuration"),
      await api<Default>("/api/admin/llm/defaults/runtime"),
    ]);
    setSpList(await api<SearchProvider[]>("/api/admin/search/providers"));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 3500);
  };

  const createProvider = async () => {
    try {
      await api("/api/admin/llm/providers", { method: "POST", body: JSON.stringify({ name: pName, type: pType, base_url: pBase, api_key: pKey }) });
      setPName("");
      setPBase("");
      setPKey("");
      flash("Provider 已创建");
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "创建失败");
    }
  };

  const createModel = async () => {
    try {
      await api("/api/admin/llm/models", { method: "POST", body: JSON.stringify({ provider_id: mProvider, model_key: mKey, display_name: mName }) });
      setMKey("");
      setMName("");
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

  // ============ 搜索服务 ============
  const addSearchProvider = async () => {
    try {
      await api("/api/admin/search/providers", { method: "POST", body: JSON.stringify({ name: spName, type: spType, api_key: spKey }) });
      setSpName("");
      setSpKey("");
      flash("搜索供应商已添加");
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "创建失败");
    }
  };

  const testSearchProvider = async (id: string) => {
    setSpTesting(id);
    try {
      const res = await api<{ ok: boolean; results?: number; latency_ms?: number; quota_remaining?: number | null; error?: string }>(
        `/api/admin/search/providers/${id}/test`,
        { method: "POST" },
      );
      flash(
        res.ok
          ? `搜索正常（${res.latency_ms}ms，${res.results} 条结果${res.quota_remaining !== null && res.quota_remaining !== undefined ? `，剩余额度 ${res.quota_remaining}` : ""}）`
          : `测试失败：${res.error}`,
      );
    } finally {
      setSpTesting(null);
      load();
    }
  };

  const toggleSearchProvider = async (id: string, active: boolean) => {
    await api(`/api/admin/search/providers/${id}`, { method: "PATCH", body: JSON.stringify({ status: active ? "active" : "disabled" }) });
    load();
  };

  const testFetch = async () => {
    const url = prompt("输入要读取的网页 URL：", "https://pvp.qq.com/");
    if (!url) return;
    setSpTesting("fetch");
    try {
      const res = await api<{ ok: boolean; title?: string; chars?: number; error?: string }>("/api/admin/search/fetch-test", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      flash(res.ok ? `网页读取正常：${res.title}（${res.chars} 字符）` : `读取失败：${res.error}`);
    } finally {
      setSpTesting(null);
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">模型与搜索服务</h1>
      {msg && <div className="mb-4 rounded-lg bg-orange-50 px-4 py-2 text-sm text-[#c2410c]">{msg}</div>}

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">场景默认模型</h2>
          {defaults.map((d) => (
            <div key={d.scenario} className="mb-3">
              <label className="label">{d.scenario === "configuration" ? "配置 Agent" : "运行时 Agent"}</label>
              <select className="input" value={d.model_id ?? ""} onChange={(e) => setDefault(d.scenario, e.target.value)}>
                <option value="">未配置（将报错）</option>
                {models
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}（{m.model_key}）
                    </option>
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
          <button className="btn-primary" onClick={createProvider} disabled={!pName || !pBase || !pKey}>
            创建 Provider
          </button>
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
                    <p className="font-medium">
                      {p.name} <span className="badge bg-slate-100 text-slate-500">{p.type}</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {p.base_url} · Key {p.api_key_mask} · v{p.config_version}
                    </p>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-center text-slate-400">暂无</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-semibold">新增模型</h2>
          <label className="label">Provider</label>
          <select className="input mb-2" value={mProvider} onChange={(e) => setMProvider(e.target.value)}>
            <option value="">选择…</option>
            {providers
              .filter((p) => p.status === "active")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <label className="label">模型 ID</label>
          <input className="input mb-2" value={mKey} onChange={(e) => setMKey(e.target.value)} placeholder="deepseek-v4.1-flash" />
          <label className="label">显示名</label>
          <input className="input mb-3" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="DeepSeek V4.1 Flash" />
          <button className="btn-primary" onClick={createModel} disabled={!mProvider || !mKey || !mName}>
            添加模型
          </button>
        </div>
      </div>

      <div className="card mb-8 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 font-semibold">模型列表</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-3">显示名</th>
              <th className="px-5 py-3">模型 ID</th>
              <th className="px-5 py-3">Provider</th>
              <th className="px-5 py-3">能力</th>
              <th className="px-5 py-3">状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="border-b border-slate-50">
                <td className="px-5 py-3 font-medium">{m.display_name}</td>
                <td className="px-5 py-3 font-mono text-xs">{m.model_key}</td>
                <td className="px-5 py-3 text-slate-500">{m.provider_name}</td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  {[m.capabilities?.tool_call && "工具", m.capabilities?.vision && "视觉", m.capabilities?.json && "JSON", m.capabilities?.reasoning_summary && "推理摘要"]
                    .filter(Boolean)
                    .join(" / ") || "—"}
                </td>
                <td className="px-5 py-3">
                  {m.status === "active" ? <span className="badge bg-green-50 text-green-600">启用</span> : <span className="badge bg-slate-100 text-slate-500">停用</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  <button className="btn-ghost" onClick={() => testModel(m.id)}>
                    测试连接
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ============ 搜索服务 ============ */}
      <div>
        <h2 className="mb-1 text-lg font-bold text-slate-900">搜索服务（运行时 Agent 联网工具）</h2>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          启用后，客服 Agent 获得 web_search / web_fetch 工具，用于回答时效性公开问题。支持 Brave 与 Exa；多供应商自动按剩余额度/限流状态轮换，额度耗尽自动切换并在冷却后重试。
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-5">
            <h3 className="mb-3 font-semibold">新增搜索供应商</h3>
            <label className="label">名称</label>
            <input className="input mb-2" value={spName} onChange={(e) => setSpName(e.target.value)} placeholder="如：Exa 官方" />
            <label className="label">类型</label>
            <select className="input mb-2" value={spType} onChange={(e) => setSpType(e.target.value)}>
              <option value="exa">Exa（api.exa.ai）</option>
              <option value="brave">Brave（api.search.brave.com）</option>
            </select>
            <label className="label">API Key</label>
            <input className="input mb-3" value={spKey} onChange={(e) => setSpKey(e.target.value)} placeholder={spType === "exa" ? "xxxxxxxx-xxxx-xxxx-…" : "BSAi_…"} />
            <div className="flex items-center gap-2">
              <button className="btn-primary" onClick={addSearchProvider} disabled={!spName || !spKey}>
                添加
              </button>
              <button className="btn-ghost" onClick={testFetch} disabled={spTesting === "fetch"}>
                {spTesting === "fetch" ? "读取中…" : "测试 WebFetch"}
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3 font-semibold">已配置供应商</div>
            <table className="w-full text-sm">
              <tbody>
                {spList.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium">
                        {p.name} <span className="badge bg-slate-100 text-slate-500">{p.type}</span>
                        {p.status === "active" ? (
                          <span className="badge bg-green-50 text-green-600 ml-1">启用</span>
                        ) : (
                          <span className="badge bg-slate-100 text-slate-500 ml-1">停用</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">
                        Key {p.api_key_mask} · {p.last_status ? `最近状态 ${p.last_status}` : "未使用"}
                        {p.quota_remaining !== null && p.quota_remaining !== undefined ? ` · 剩余额度 ${p.quota_remaining}` : ""}
                        {p.last_error ? ` · ${p.last_error.slice(0, 50)}` : ""}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <button className="btn-ghost" onClick={() => testSearchProvider(p.id)} disabled={spTesting === p.id}>
                        {spTesting === p.id ? "测试中…" : "实测"}
                      </button>
                      <button
                        className={p.status === "active" ? "btn-danger ml-2" : "btn-ghost ml-2"}
                        onClick={() => toggleSearchProvider(p.id, p.status !== "active")}
                      >
                        {p.status === "active" ? "停用" : "启用"}
                      </button>
                    </td>
                  </tr>
                ))}
                {spList.length === 0 && (
                  <tr>
                    <td className="px-5 py-6 text-center text-slate-400">暂无供应商，添加后运行时 Agent 自动获得联网工具</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
