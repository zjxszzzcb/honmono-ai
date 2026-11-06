import * as storage from "@honmono/storage";

export async function ensureDirs() {
  console.log(`[api] storage root = ${storage.storageRoot()}`);
  await storage.ensureDir(".");
}
