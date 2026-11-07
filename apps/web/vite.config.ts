import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    allowedHosts: true, // 允许 Cloudflare Tunnel 域名访问（演示用途）
    proxy: {
      "/api/": "http://localhost:4001",
      "/v1/": "http://localhost:4001",
    },
  },
});
