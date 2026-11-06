import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

export const redisConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const queues = new Map<string, Queue>();

export function getQueue(name: "chat" | "config" | "files" | "delays"): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnection });
    queues.set(name, q);
  }
  return q;
}
