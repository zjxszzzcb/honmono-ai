import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.APP_SESSION_SECRET ?? "dev-insecure-secret";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = {
  sub: string;
  typ: "merchant" | "admin";
  exp: number; // unix seconds
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signSession(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", SECRET).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function newSession(sub: string, typ: "merchant" | "admin"): { token: string; maxAge: number } {
  const token = signSession({ sub, typ, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS });
  return { token, maxAge: MAX_AGE_SECONDS };
}

export const SESSION_COOKIE = "honmono_session";
export const ADMIN_SESSION_COOKIE = "honmono_admin_session";
