# ============ 基础 API 镜像（api / worker / migrate 共用）============
FROM node:22-alpine AS base
WORKDIR /app
# 单仓库：先拷贝清单以利用层缓存
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/agent/package.json packages/agent/
COPY packages/storage/package.json packages/storage/
# 构建期 npm 代理（中国网络可设 http://host.docker.internal:7890；默认直连）
ARG NPM_PROXY=""
ENV npm_config_proxy=${NPM_PROXY} npm_config_https_proxy=${NPM_PROXY}
RUN npm ci --no-audit --no-fund

# ---------- api ----------
FROM base AS api
COPY . .
ENV NODE_ENV=production
EXPOSE 4001
CMD ["npx", "tsx", "apps/api/src/index.ts"]

# ---------- worker ----------
FROM base AS worker
COPY . .
ENV NODE_ENV=production
CMD ["npx", "tsx", "apps/worker/src/index.ts"]

# ---------- migrate（一次性任务：Drizzle 迁移 + 初始管理员 + 默认设置）----------
FROM base AS migrate
COPY . .
ENV NODE_ENV=production
CMD ["npx", "tsx", "packages/db/src/run-migrate.ts"]

# ---------- web 构建 ----------
FROM node:22-alpine AS web-build
WORKDIR /app
COPY apps/web/package.json apps/web/
COPY package.json package-lock.json tsconfig.base.json ./
ARG NPM_PROXY=""
ENV npm_config_proxy=${NPM_PROXY} npm_config_https_proxy=${NPM_PROXY}
RUN npm ci --no-audit --no-fund -w apps/web || npm install --no-audit --no-fund
COPY apps/web apps/web
RUN npm run build -w apps/web

# ---------- web 运行（nginx 静态 + 反代）----------
FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
