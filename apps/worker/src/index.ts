import { and, eq, lte } from "drizzle-orm";
import { eq as eqOp } from "drizzle-orm";
import { Worker, type Job } from "bullmq";
import {
  appendMessage,
  conversations,
  db,
  getRunById,
  runs,
  transitionRun,
} from "@honmono/db";
import { redisConnection, getQueue } from "./queues.js";
import { executeChatAgent, withConversationLock, closeRedis } from "./agent-executor.js";
import { executeConfigRun } from "./config-run.js";
import { parseUpload } from "./parse-file.js";
import { shutdownLangfuse, setupGlobalProxy, setupLangfuseOtel } from "@honmono/agent";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

await setupGlobalProxy();
await setupLangfuseOtel();

// ============ 生产聊天 Run ============
const chatWorker = new Worker(
  "chat",
  async (job: Job<{ runId: string; endUserId?: string | null }>) => {
    const run = await getRunById(job.data.runId);
    if (!run) return;
    const res = await withConversationLock(run.conversationId, () =>
      executeChatAgent({ runId: job.data.runId, withEndUserHash: job.data.endUserId ?? null }),
    );
    if (res === "lock_timeout") {
      // 等锁超时：重新排队，稍后再试
      await transitionRun(job.data.runId, "queued", {}) ;
      throw new Error("conversation_lock_timeout");
    }
    if (res.type === "waiting_input") {
      // 调度延时任务
      await getQueue("delays").add(
        "sleep-fire",
        { runId: job.data.runId },
        { delay: res.sleepSeconds * 1000 + 250, removeOnComplete: 500, jobId: `sleep-${job.data.runId}` },
      );
    }
  },
  { connection: redisConnection, concurrency: CONCURRENCY },
);

// ============ 配置 Run ============
const configWorker = new Worker(
  "config",
  async (job: Job<{ runId: string }>) => {
    const run = await getRunById(job.data.runId);
    if (!run) return;
    await withConversationLock(run.conversationId, async () => {
      await executeConfigRun(job.data.runId);
    });
  },
  { connection: redisConnection, concurrency: Math.max(1, Math.floor(CONCURRENCY / 2)) },
);

// ============ 文件解析 ============
const filesWorker = new Worker(
  "files",
  async (job: Job<{ uploadId: string }>) => {
    await parseUpload(job.data.uploadId);
  },
  { connection: redisConnection, concurrency: 2 },
);

// ============ sleep 到期触发 ============
const delayWorker = new Worker(
  "delays",
  async (job: Job<{ runId: string }>) => {
    const run = await getRunById(job.data.runId);
    if (!run || run.state !== "waiting_input") return; // 已被取代或其他状态：幂等跳过
    if (!run.deadlineAt || run.deadlineAt.getTime() > Date.now() + 200) {
      // 未到期（异常早触发）：重新排队
      await transitionRun(run.id, "waiting_input", {});
      await job.retry("early_fire" as never);
      return;
    }
    // 原子检查仍为 waiting_input 才落库
    const moved = await transitionRun(run.id, "waiting_input", {
      state: "succeeded",
      finishedAt: new Date(),
      resultJson: { content: run.pendingText, note: "sleep_expired_reply" },
    });
    if (!moved) return;
    await appendMessage({
      conversationId: run.conversationId,
      serviceId: run.serviceId,
      role: "assistant",
      authorType: "ai",
      content: run.pendingText ?? "",
      runId: run.id,
    });
  },
  { connection: redisConnection, concurrency: 4 },
);

for (const [name, w] of Object.entries({ chat: chatWorker, config: configWorker, files: filesWorker, delays: delayWorker })) {
  w.on("failed", (job, err) => {
    console.error(`[worker:${name}] job ${job?.id} failed:`, err.message);
  });
  w.on("completed", (job) => {
    console.log(`[worker:${name}] job ${job.id} completed`);
  });
}

console.log(`[worker] started (concurrency=${CONCURRENCY})`);

// 优雅停机
async function shutdown() {
  console.log("[worker] shutting down...");
  await Promise.allSettled([chatWorker.close(), configWorker.close(), filesWorker.close(), delayWorker.close()]);
  await shutdownLangfuse().catch(() => {});
  await closeRedis();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 兜底：启动时恢复中断的 waiting_input（Worker 重启后延时任务可能丢失）
async function recoverWaitingRuns() {
  const rows = await db
    .select()
    .from(runs)
    .where(and(eqOp(runs.state, "waiting_input"), lte(runs.deadlineAt, new Date(Date.now() + 60_000))));
  for (const r of rows) {
    const delay = Math.max(0, (r.deadlineAt?.getTime() ?? Date.now()) - Date.now());
    await getQueue("delays").add("sleep-fire", { runId: r.id }, { delay, jobId: `sleep-${r.id}` });
  }
  if (rows.length) console.log(`[worker] recovered ${rows.length} waiting_input runs`);
}
recoverWaitingRuns().catch((e) => console.error("[worker] recover failed:", e));
