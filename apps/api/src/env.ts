export type AppEnv = {
  Variables: {
    merchant: { sub: string } | null;
    admin: { sub: string; email: string } | null;
  };
};

export const API_PORT = Number(process.env.API_PORT ?? 4001);
