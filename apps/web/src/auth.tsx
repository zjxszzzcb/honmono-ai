import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Merchant = { id: string; account: string; activated: boolean } | null;
type Admin = { id: string; email: string } | null;

type AuthCtx = {
  merchant: Merchant;
  admin: Admin;
  loading: boolean;
  refresh: () => Promise<void>;
  setMerchant: (m: Merchant) => void;
  setAdmin: (a: Admin) => void;
};

const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [merchant, setMerchant] = useState<Merchant>(null);
  const [admin, setAdmin] = useState<Admin>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      setMerchant(res.ok ? await res.json() : null);
    } catch {
      setMerchant(null);
    }
    try {
      const res = await fetch("/api/admin/auth/me", { credentials: "include" });
      setAdmin(res.ok ? await res.json() : null);
    } catch {
      setAdmin(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  return <Ctx.Provider value={{ merchant, admin, loading, refresh, setMerchant, setAdmin }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}
