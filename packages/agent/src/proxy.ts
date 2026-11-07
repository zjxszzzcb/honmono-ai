let done = false;

/**
 * 进程启动时按标准环境变量配置全局出站代理。
 * HTTPS_PROXY / HTTP_PROXY 生效；NO_PROXY 排除本地与内网地址（如模型网关）。
 * 未设置环境变量时为无操作。需要在进程 boot 阶段 await 一次。
 */
export async function setupGlobalProxy(): Promise<void> {
  if (done) return;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy) return;
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
    done = true;
    console.log(`[proxy] global outbound proxy enabled (${proxy})`);
  } catch (err) {
    console.error("[proxy] setup failed:", err instanceof Error ? err.message : err);
  }
}
