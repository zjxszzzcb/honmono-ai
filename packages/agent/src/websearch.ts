import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ============ 类型 ============
export type SearchProviderInfo = {
  id: string;
  name: string;
  type: "brave" | "exa";
  apiKey: string;
};

export type WebSearchResult = { title: string; url: string; snippet: string };

export type ProviderState = {
  status: "available" | "cooldown" | "exhausted";
  cooldownUntil: number;
  quotaRemaining: number | null;
  lastError: string | null;
  lastUsedAt: number;
};

export type RouterEvent = (e: { type: "provider.result" | "provider.skip"; provider: string; detail: string }) => void;

export type SearchPersist = (
  providerId: string,
  patch: { quotaRemaining?: number | null; lastStatus?: string; lastError?: string | null; lastUsedAt?: Date },
) => void;

/** 供应商轮换路由：额度感知 + 错误冷却 + LRU 均衡 */
export class SearchRouter {
  private providers: SearchProviderInfo[];
  private state = new Map<string, ProviderState>();
  private persist?: SearchPersist;
  private onEvent?: RouterEvent;

  constructor(providers: SearchProviderInfo[], opts?: { persist?: SearchPersist; onEvent?: RouterEvent }) {
    this.providers = providers;
    this.persist = opts?.persist;
    this.onEvent = opts?.onEvent;
    for (const p of providers) {
      this.state.set(p.id, { status: "available", cooldownUntil: 0, quotaRemaining: null, lastError: null, lastUsedAt: 0 });
    }
  }

  private available(now = Date.now()): SearchProviderInfo[] {
    return this.providers
      .filter((p) => {
        const st = this.state.get(p.id)!;
        if (st.status === "exhausted") return false;
        if (st.status === "cooldown" && now < st.cooldownUntil) return false;
        return true;
      })
      .sort((a, b) => {
        const sa = this.state.get(a.id)!;
        const sb = this.state.get(b.id)!;
        // 已知剩余额度多的优先（未知视为中性 0）
        const qa = sa.quotaRemaining ?? 0;
        const qb = sb.quotaRemaining ?? 0;
        if (qa !== qb) return qb - qa;
        return sa.lastUsedAt - sb.lastUsedAt; // LRU
      });
  }

  /** 依次尝试可用供应商；全部不可用返回 null */
  async search(query: string, count = 5): Promise<{ provider: string; results: WebSearchResult[] } | null> {
    const now = Date.now();
    const candidates = this.available(now).slice();
    for (const p of candidates) {
      const st = this.state.get(p.id)!;
      st.lastUsedAt = now;
      try {
        const { results, quotaRemaining } =
          p.type === "brave" ? await braveSearch(p.apiKey, query, count) : await exaSearch(p.apiKey, query, count);
        st.status = "available";
        st.lastError = null;
        if (quotaRemaining !== null && Number.isFinite(quotaRemaining)) st.quotaRemaining = quotaRemaining;
        this.persist?.(p.id, { quotaRemaining: st.quotaRemaining, lastStatus: "ok", lastError: null, lastUsedAt: new Date() });
        this.onEvent?.({ type: "provider.result", provider: p.name, detail: `${results.length} 条结果` });
        return { provider: p.name, results };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof SearchQuotaError) {
          st.status = "exhausted";
          st.quotaRemaining = 0;
          st.lastError = msg;
          this.persist?.(p.id, { quotaRemaining: 0, lastStatus: "exhausted", lastError: msg });
          this.onEvent?.({ type: "provider.skip", provider: p.name, detail: "额度耗尽，切换下一供应商" });
        } else if (err instanceof SearchRateLimitError) {
          st.status = "cooldown";
          st.cooldownUntil = Date.now() + 65_000;
          st.lastError = msg;
          this.persist?.(p.id, { lastStatus: "rate_limited", lastError: msg });
          this.onEvent?.({ type: "provider.skip", provider: p.name, detail: "触发限流，冷却 65s" });
        } else {
          st.status = "cooldown";
          st.cooldownUntil = Date.now() + 30_000;
          st.lastError = msg.slice(0, 200);
          this.persist?.(p.id, { lastStatus: "error", lastError: st.lastError });
          this.onEvent?.({ type: "provider.skip", provider: p.name, detail: `错误：${msg.slice(0, 80)}` });
        }
      }
    }
    return null;
  }
}

export class SearchQuotaError extends Error {}
export class SearchRateLimitError extends Error {}

// ============ Brave ============
async function braveSearch(apiKey: string, query: string, count: number): Promise<{ results: WebSearchResult[]; quotaRemaining: number | null }> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(Math.max(count, 1), 8)));
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey, "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  const quota = parseRemaining(res.headers, ["x-ratelimit-remaining", "x-ratelimit-remaining-monthly"]);
  if (res.status === 429) throw new SearchRateLimitError("Brave 触发限流");
  if (res.status === 401 || res.status === 403) throw new Error("Brave Key 无效或无权限");
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
  const results = (data.web?.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.description ?? "").replace(/<[^>]+>/g, ""),
  }));
  return { results, quotaRemaining: quota };
}

// ============ Exa ============
async function exaSearch(apiKey: string, query: string, count: number): Promise<{ results: WebSearchResult[]; quotaRemaining: number | null }> {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      numResults: Math.min(Math.max(count, 1), 8),
      contents: { text: { maxCharacters: 400 } },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const quota = parseRemaining(res.headers, ["x-exa-api-quota-remaining"]);
  if (res.status === 402 || res.status === 403) throw new SearchQuotaError("Exa 额度耗尽或 Key 无效");
  if (res.status === 429) throw new SearchRateLimitError("Exa 触发限流");
  if (!res.ok) throw new Error(`Exa HTTP ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title: string; url: string; text?: string }> };
  const results = (data.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.text ?? "").replace(/\s+/g, " ").trim(),
  }));
  return { results, quotaRemaining: quota };
}

function parseRemaining(headers: Headers, candidates: string[]): number | null {
  for (const name of candidates) {
    const v = headers.get(name);
    if (v !== null && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  }
  return null;
}

// ============ WebFetch（带 SSRF 防护）============
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
];

async function assertPublicHost(hostname: string): Promise<void> {
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(hostname))) {
    throw new Error("禁止访问内网地址");
  }
  const dns = await import("node:dns/promises");
  const addrs = await dns.lookup(hostname, { all: true }).catch(() => null);
  if (!addrs || addrs.length === 0) throw new Error("域名无法解析");
  for (const a of addrs) {
    const ip = a.address;
    if (
      /^127\./.test(ip) ||
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
      /^169\.254\./.test(ip) ||
      ip === "::1" ||
      /^f[cd]/i.test(ip)
    ) {
      throw new Error("域名解析到内网地址，已拦截");
    }
  }
}

async function fetchWithGuard(target: string): Promise<Response> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error("URL 格式非法");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("仅支持 http/https");
  await assertPublicHost(url.hostname);
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "HonmonoAI-WebFetch/1.0" } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("重定向缺少 Location");
      current = new URL(loc, current);
      await assertPublicHost(current.hostname);
      continue;
    }
    return res;
  }
  throw new Error("重定向次数过多");
}

function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x?[0-9a-fA-F]+;/g, " ");
  t = t.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return { title, text: t };
}

export async function webFetch(target: string, maxChars = 6000): Promise<{ title: string; url: string; text: string }> {
  const res = await fetchWithGuard(target);
  if (res.status >= 400) throw new Error(`目标返回 HTTP ${res.status}`);
  const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!/text\/html|text\/plain|application\/json|text\/x-|xml/.test(ctype)) {
    throw new Error(`不支持的内容类型: ${ctype.split(";")[0] || "未知"}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 2 * 1024 * 1024) throw new Error("页面超过 2MB，已拒绝");
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  let title = "";
  let text: string;
  if (/text\/html/.test(ctype)) {
    const parsed = htmlToText(raw);
    title = parsed.title;
    text = parsed.text;
  } else {
    text = raw;
  }
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…[内容已截断]`;
  return { title, url: res.url || target, text };
}

// ============ 工具工厂 ============
export function createWebTools(router: SearchRouter, onEvent?: (e: { name: string; summary: string }) => void) {
  const webSearchTool = tool(
    async ({ query, count }) => {
      onEvent?.({ name: "web_search", summary: `搜索：${query.slice(0, 50)}` });
      const r = await router.search(query, count ?? 5);
      if (!r) {
        return "搜索服务暂不可用（所有供应商额度耗尽或被限流）。请基于已有知识回答，若无法确认请调用 ask_human，不要编造搜索结果。";
      }
      if (r.results.length === 0) {
        return `搜索（${r.provider}）无结果。请换一个关键词，或基于已有知识回答。`;
      }
      const lines = r.results.map((x, i) => `[${i + 1}] ${x.title}\n    ${x.url}\n    ${x.snippet.slice(0, 220)}`);
      return `搜索结果（来源：${r.provider}）：\n${lines.join("\n")}`;
    },
    {
      name: "web_search",
      description:
        "联网搜索公开信息。当玩家询问时效性内容（版本活动、赛事赛程、最新公告、公开常识性内容）而知识库没有时使用。注意：商户内部政策、订单、账号信息一律不搜索，以知识文件为准。",
      schema: z.object({
        query: z.string().min(1).max(200).describe("搜索关键词"),
        count: z.number().int().min(1).max(8).optional().describe("结果条数，默认 5"),
      }),
    },
  );

  const webFetchTool = tool(
    async ({ url, max_chars }) => {
      onEvent?.({ name: "web_fetch", summary: `读取网页：${url.slice(0, 60)}` });
      try {
        const page = await webFetch(url, max_chars ?? 6000);
        return `网页内容（${page.title || page.url}）：\n${page.text}`;
      } catch (err) {
        return `网页读取失败：${err instanceof Error ? err.message : String(err)}。请改用其他来源或基于已有知识回答。`;
      }
    },
    {
      name: "web_fetch",
      description: "读取指定网页的正文内容（需先通过 web_search 获得 URL）。仅支持公开网页的文本内容。",
      schema: z.object({
        url: z.string().url().describe("要读取的网页 URL"),
        max_chars: z.number().int().min(500).max(12000).optional().describe("最多返回字符数，默认 6000"),
      }),
    },
  );

  return { webSearchTool, webFetchTool };
}

/** 附加到系统提示的联网工具使用规范 */
export const WEB_TOOL_RULES = `
## 联网工具使用
- web_search / web_fetch 用于查询公开、时效性信息（活动、版本、赛事、公告）。查询词使用与问题相关的中文关键词。
- 知识文件中有明确政策的内容以知识文件为准，不要用搜索结果覆盖商户政策。
- 不搜索、不透露任何玩家隐私或商户内部信息；搜索词保持中性、专业。
- 引用搜索到的事实时附带来源 URL；搜索失败或结果为空时如实说明，不要编造。
`;
