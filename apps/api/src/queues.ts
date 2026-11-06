import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const queues = new Map<string, Queue>();

export function getQueue(name: "chat" | "config" | "files" | "delays"): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection });
    queues.set(name, q);
  }
  return q;
}

export const redisConnection = connection;
