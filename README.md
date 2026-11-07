# Honmono AI · 轻量 AI 客服产品

聊天式配置、版本化 Agent Skill、非流式 Chat API、人工接管、Langfuse 全链路追踪、Docker Compose 一键部署。

## 架构

```
apps/web        React + Vite + Tailwind（官网 / 商户后台 / 管理员后台，nginx 托管）
apps/api        Hono REST（认证、配置、文件、Key、测试 SSE、公开 /v1、管理员）
apps/worker     BullMQ Worker（配置 Agent、运行时 Agent、文件解析、sleep/取代）
packages/
  contracts     Zod Schema 与共享类型
  db            Drizzle Schema + 服务层（Run 状态机 / 会话 / 模型解析 / 审计）
  agent         模型工厂 + Deep Agents 工厂（受限工具 + response 契约 + Langfuse OTel）
  storage       本地存储适配器（路径围栏；接口保持，可换 S3）
skills/
  create-customer-service   配置 Agent 技能（采访手册 / 就绪契约 / 输出契约 / 行业参考 / 校验脚本）
deploy/dev     开发用 compose（本地 Node + 容器化中间件）
```

**配置工作台**：`/services/:id/configure` 为 VSCode 式三栏布局——左侧资源管理器（草稿文件树实时刷新，上传原件自动存入 `assets/raw/`）、中间多 Tab 文本编辑器（可编辑保存，⌘S）、右侧配置助手对话（打字机效果）。

**Agent 运行方式**：`deepagents`（LangGraph）+ 固定加载当前 Skill 版本（SKILL.md 进系统提示词）；文件工具 `ls/read_file/glob/grep` 通过 `FilesystemBackend({ virtualMode: true })` 限定在版本目录内（拦截 `..`/`~`/symlink 逃逸）；配置 Agent 额外具备 `write_file/edit_file` 与服务端固定实现的 `validate_skill/publish_skill`；危险工具（delete/execute/task 子代理）一律排除。运行时 Agent 只能通过 `response`（text, sleep 0 或 2–30s）回复、通过 `ask_human` 转人工。

## 快速开始（Docker Compose 全量部署）

```bash
cp .env.example .env        # 替换全部 <random> 密钥
docker compose --profile app up -d --build
# 应用入口： http://localhost:8080
# Langfuse： http://localhost:3000
```

首次启动：
1. `migrate` 任务执行 Drizzle 迁移并按 `ADMIN_INITIAL_EMAIL/PASSWORD` 幂等创建初始管理员。
2. Langfuse 由 `LANGFUSE_INIT_*` 自动创建组织 / 项目 / API Key / 初始用户。
3. 登录管理员 → `/admin/llm` 添加 Provider（如 Anthropic 兼容网关）与模型 → 测试连接 → 设置"配置 Agent"与"运行时 Agent"默认模型。
4. `/admin/invites` 生成邀请码 → 注册商户 → 兑换邀请码 → 一键创建客服 → 聊天式配置 / 上传资料 → 达到最低就绪条件自动发布并置为可用。
5. 客服详情 → API Key 页创建 Key → 以 `Authorization: Bearer <key>` 调用：

```bash
curl -X POST http://localhost:8080/v1/customer-services/<serviceId>/chat \
  -H "Authorization: Bearer cs_live_xxx" -H "Content-Type: application/json" \
  -d '{"request_id":"<uuid>","conversation_id":"player-1","messages":[{"role":"user","content":"你好"}]}'
```

人工回复通过 `GET /v1/customer-services/<id>/conversations/<cid>/messages?after=<msgId>` 增量拉取。

## 本地开发（JS 本地跑 + 中间件容器化）

```bash
docker compose -f deploy/dev/docker-compose.yml up -d   # Postgres(5433)/Redis(6380)/Langfuse(3000)
npm install
cp .env.example .env    # 开发默认值
npm run db:migrate      # 迁移 + 初始管理员 + 默认设置
npm run dev:api &       # http://localhost:4001
npm run dev:worker &
npm run dev:web &       # http://localhost:5173（代理 /api、/v1）
```

## 数据与文件

- 所有业务数据在 PostgreSQL（商户 / 客服 / Skill 版本 / 消息 / Run / 求助 / Key / LLM 配置 / 审计）。
- 文件与 Skill 版本落在 `STORAGE_ROOT`：`merchants/{mid}/services/{sid}/drafts|versions|incoming`；数据库只存相对路径。
- 发布 = 草稿目录复制为不可变版本 + 原子切换 `active_skill_version_id`（只改数据库指针）。

## 联网搜索（WebSearch / WebFetch）

管理员在 `/admin/llm`（模型与搜索服务）配置搜索供应商（**Brave** / **Exa**），运行时 Agent 自动获得：

- `web_search`：联网搜索公开信息；多供应商**额度感知自动轮换**（响应头额度采集 → 402/429 错误冷却切换 → LRU 均衡），状态与剩余额度在管理页可见
- `web_fetch`：读取网页正文（SSRF 防护：拦截内网/环回地址与重定向逃逸，2MB 上限）
- 商户政策以知识文件为准的提示词约束，搜索结果要求附带来源 URL

中国网络部署：在 `.env` 设置标准代理变量即可（应用启动时全局生效，无需前端配置）：

```
HTTPS_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1,<模型网关地址>
```

## 安全要点（已实现）

- 密码 Argon2id；会话 HMAC HttpOnly Cookie；管理员独立会话。
- API Key 仅存哈希，前缀识别，可吊销；公开接口按 serviceId 强绑定。
- 平台 LLM Key AES-256-GCM 加密存储，接口只返回掩码。
- Agent 文件访问双保险：`virtualMode` 虚拟根 + 保存层路径围栏；运行时无写入 / 无 Shell / 无子代理。
- 管理员关键操作全部写入审计日志（不含明文密钥）。

## 已知事项（MVP 范围外或待完善）

1. **Langfuse session 分组**：trace 已完整记录（模型 / 工具 / response 链路）；`session_id` 字段需用 OTel baggage 进一步传递（`@langfuse/core` 的 `setLangfuseTraceIdInBaggage`），当前 trace 间以 metadata 关联。
2. **Langfuse v4 自托管**：自托管 ingestion 需要 `LANGFUSE_MIGRATION_V4_WRITE_MODE=dual`（已在两个 compose 中设置）；否则 OTLP 事件不入 ClickHouse。
3. 测试台在 API 进程内执行（不走 Worker 队列），与生产共用 Agent 工厂；仅建议低频使用。
4. PDF 解析依赖文本层，扫描件标记 `failed` 并引导商户粘贴关键内容；图片不做 OCR。
5. 模型偶发不调用 `response` 工具时，系统会降级采用其最后成文本发送并在 Run 上标记 `response_contract_degraded`（可观测，不中断服务）。
6. `docker compose down -v` 会删除数据卷，不作为常规停止命令；备份至少覆盖 `postgres-data`、`clickhouse-data`、`minio-data`、`app-storage`。
