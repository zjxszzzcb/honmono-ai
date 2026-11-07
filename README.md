# Honmono AI · 轻量 AI 客服产品

聊天式配置、版本化 Agent Skill、非流式 Chat API、人工接管、Langfuse 全链路可观测、Docker Compose 一键部署。

> 本文档配套 `docs/screenshots/` 下的 14 张端到端截图（王者荣耀示例），覆盖从创建客服到上线接入、人工接管、链路追踪的完整旅程。

---

## 1. 架构总览

```
apps/web        React + Vite + Tailwind（商户端工作台 / 人工接管台 / API 看板 / 管理员后台）
apps/api        Hono REST（认证、配置、文件、Key、测试 SSE、公开 /v1、管理接口）
apps/worker     BullMQ Worker（配置 Agent、运行时 Agent、文件解析、sleep/取代、打断）
packages/
  contracts     Zod Schema 与共享类型
  db            Drizzle Schema + 服务层（Run 状态机 / 会话 / 模型与搜索解析 / 审计）
  agent         Deep Agents 工厂（受限工具 + response 契约 + 打断中间件 + 搜索路由 + Langfuse OTel）
  storage       本地存储适配器（路径围栏；接口保持，可切换 S3）
skills/
  create-customer-service   配置 Agent 技能（采访手册 / 就绪契约 / 输出契约 / 行业参考 / 校验脚本）
deploy/dev      开发用 compose（本地 Node + 容器化中间件）
e2e-package     王者荣耀示例：资料包 zip + 测试用例 + 跑测脚本
```

**Agent 运行方式**：`deepagents`（LangGraph）+ 固定加载当前 Skill 版本（SKILL.md 进系统提示词）；文件工具 `ls/read_file/glob/grep` 通过 `FilesystemBackend({ virtualMode: true })` 限定在版本目录内；配置 Agent 额外具备 `write_file/edit_file` 与服务端固定实现的 `validate_skill/publish_skill`；危险工具（delete/execute/task 子代理）一律排除。

---

## 2. 功能说明（按模块）

### 2.1 商户端

- **注册 → 邀请码激活 → 创建客服**：邀请码只存哈希、事务核销防并发重兑；未激活商户在 API 层被拒绝创建（403 activation_required）。
- **AI 客服看板**：卡片展示名称/描述（Agent 发布后自动生成，也可手动编辑）、运行版本、转人工待处理数；删除需二次输入名称确认，Key 一并失效。

![Dashboard](docs/screenshots/01-dashboard.png)

### 2.2 配置工作台（VSCode 式三栏）

`/services/:id/configure`，参考 codex / claude-code 的交互模型：

- **初始态 = 聊天全屏居中**（问候 + 引导），Agent 首次回复后自动展开文件面板，右上角「文件」按钮随时手动开合。
- **聊天栏**：自然语言配置；`ask_user` 工具会把选择题渲染成**可点选的选项卡片**（1-3 题 × 2-6 选项 + 补充说明），回答作为普通消息进入对话；打字机效果输出。
- **资源管理器**：草稿文件树实时刷新；上传资料（含 **zip 资料包**，自动解包逐个解析）原件存入 `assets/raw/`。
- **编辑器**：多 Tab 打开任意草稿文件直接编辑，⌘S 保存（路径双围栏 + 512KB 上限）。
- **自主研究**：商户给出官网/产品名等线索时，Agent 主动 `web_search / web_fetch` 取证，结论写入 `references/research-notes.md`（来源 + 抓取时间 + 置信度），待商户拍板的事项写入 `references/open-questions.md`，后续二次确认。
- **打断**：Agent 工作中发来新消息 → InterruptMiddleware 在模型/工具调用边界秒级中断当前 Run（`interrupted`），新 Run 带完整历史接手，被打断方静默退出。
- **发布**：`validate_skill`（确定性结构/占位符/死链校验）通过后 `publish_skill` 事务复制草稿为不可变版本并原子切换 active 指针；名称/描述若还是默认值会自动用生成的元信息替换。

![工作台与资料包](docs/screenshots/02-workbench-upload-zip.png)
![ask_user 选项卡片](docs/screenshots/04-ask-user-card.png)
![编辑器打开 SKILL.md](docs/screenshots/05-workbench-editor-skillmd.png)
![联网研究笔记](docs/screenshots/06-research-notes-preview.png)

### 2.3 测试台（SSE）

`/services/:id/test` 与生产 /chat 共用同一 Agent 核心，仅替换传输层：SSE 事件 `run.status → skill.loaded → tool.started（含 web_search/web_fetch）→ response.delta → done`，右侧执行事件时间线实时可见；测试会话独立，不污染生产历史。

![测试台联网搜索](docs/screenshots/07-test-playground-websearch.png)
![测试台转人工](docs/screenshots/08-test-playground-ask-human.png)

### 2.4 生产 Chat API（非流式）

`POST /v1/customer-services/:id/chat`（Bearer sk 密钥，sk + 16 位随机字符）：

- `request_id` 幂等（同 id 重试不重复追加消息）；`messages` 只传本次新增；服务端管理完整历史。
- 终态语义：`completed` / `waiting_for_human` / `human_controlled` / `superseded`（sleep 等待补充被新消息取代）/ `agent_failed` / 409 / 429。
- **等待补充输入**：Agent 判断用户消息不完整时调用 `response(text, sleep=2-30)` 先简短确认并等待；补充消息到达自动合并重答（DB 可见 `sleep_expired_reply` 路径）。
- `GET .../conversations/:cid/messages?after=` 增量拉取人工回复（`author_type=human`）。
- API 栏目内嵌 **API 文档页**：真实 serviceId 的 curl 示例、终态表、约定说明。

### 2.5 人工接管台

AI 不确定 / 客户情绪升级 / 要求人工时转工单：原因、需人工处理的问题、上下文摘要、**建议回复（0-3 条一键选用）**。商户可「发送并恢复 AI」或「直接接管会话」（接管期间 AI 完全静默，人工回复实时可见于玩家侧增量接口），处理完「交还 AI」。导航栏实时显示待处理数量角标。

![人工接管台](docs/screenshots/09-handoff-center-pending.png)
![建议回复并恢复 AI](docs/screenshots/10-handoff-reply-resume.png)

### 2.6 管理员后台

独立账号体系 + 独立会话 + `requireAdmin` 守卫：平台概览、商户管理（停用/启用/重置密码/软删除）、客服管理（强制停用/恢复/删除 Key/软删除）、邀请码生成与核销记录、**LLM Provider/模型配置**（Anthropic 兼容 / OpenAI 兼容，密钥 AES-256-GCM 加密仅显掩码，连接测试，配置 Agent 与运行时 Agent 分场景默认值）、**搜索服务**（Brave/Exa，额度感知自动轮换）、平台设置、审计日志（全部关键操作留痕，敏感值只存掩码）。

![管理后台概览](docs/screenshots/11-admin-overview.png)
![审计日志](docs/screenshots/12-admin-audit-logs.png)

### 2.7 可观测性：Langfuse 集成

- **接入方式**：`@langfuse/langchain` CallbackHandler（每 Run 独立实例防并发串线）+ `@langfuse/tracing` 的隔离 TracerProvider（`setLangfuseTracerProvider` 注入，规避 npm 多实例问题），OTLP 导出到自托管 Langfuse v4（`/api/public/otel/v1/traces`，Basic 认证）。
- **覆盖范围**：`configuration.run` / `chat.request` / `test.run` 三类 trace；span 树包含每次模型调用（ChatAnthropic，含 token 用量与延迟）、每次工具调用（ls/read_file/grep/write_file/web_search/web_fetch/response）、以及中间件钩子；`sessionId` 以 `serviceId:conversationId` 串联同会话多 Run；metadata 记录 skill_version / model / provider_config_version。
- **自托管注意**：v4 迁移期需 `LANGFUSE_MIGRATION_V4_WRITE_MODE=dual`（两个 compose 已内置），否则 OTLP 事件不入 ClickHouse；首次启动由 `LANGFUSE_INIT_*` 自动建组织/项目/Key/用户。
- **凭证管理**：Langfuse 密钥只通过环境变量注入，trace 里不含任何明文密钥。

![Langfuse Traces](docs/screenshots/13-langfuse-traces.png)
![Langfuse Trace 详情](docs/screenshots/14-langfuse-trace-detail.png)

---

## 3. Evaluation 规划（基于 Langfuse，规划说明暂不实现）

现有 trace 数据已具备做质量评估的全部原料（trace 树、metadata、会话串联、scores 接口）。规划分四条线：

### 3.1 数据集与回归评测（离线）
- **Datasets**：从历史 trace 中把「玩家问题 → 理想回答」沉淀为 Langfuse Dataset Item（王者荣耀场景首批建 50-100 条：充值/退款/账号/皮肤/赛事/边界拒绝六类各 8-16 条）。
- **回归门禁**：每次改动 SKILL 模板、配置 Agent 提示词或模型版本后，用 Langfuse 的 dataset run 批量重放，对比新旧输出；命中"未知事实编造""政策与知识库冲突""语气人设漂移"三类硬性规则即阻断发布。

### 3.2 在线评估（LLM-as-judge）
- 对每条生产 trace 的最终回复跑轻量评估器（复用平台已配置的模型）：维度包括 **事实一致性**（回复断言是否都能在 knowledge/research-notes 中找到依据）、**政策越界**（是否承诺了未确认的退款/补偿/解封）、**人设语气**（符合配置时选定的风格）。
- 评估分数以 `scores` 写回同一 trace，形成"质量 × 转人工率 × 延迟"的联合视图。

### 3.3 人工标注
- 人工接管台的处理结果天然是高质量标注：**采纳建议回复 = 建议质量正样本**；人工改写后再发送 = 负样本 + 改写文本可进数据集。
- Langfuse Annotation Queue：每周抽样 30 条 trace 人工打分（正确/兜底正确/编造/越界四档），反哺 judge prompt 校准。

### 3.4 运营指标（Dashboards）
- 转人工率（按 skill_version / 问题类别下钻）、sleep 等待后补充率、打断率、首答延迟（P50/P95）、web_search 依赖率、供应商轮换触发率。
- 版本对比：新版本发布后 48h 内上述指标的 A/B 对照（active_skill_version 已在 metadata 中，天然可分桶）。

---

## 4. 快速开始

### Docker Compose 全量部署

```bash
cp .env.example .env    # 替换全部 <random> 密钥
docker compose --profile app up -d --build
# 应用入口： http://localhost:8080    Langfuse： http://localhost:3000
```

首次启动：migrate 任务执行迁移并按 `ADMIN_INITIAL_EMAIL/PASSWORD` 创建初始管理员；Langfuse 由 `LANGFUSE_INIT_*` 自动建组织/项目/Key/用户。之后：管理员登录 → `/admin/llm` 配置模型与搜索服务 → `/admin/invites` 生成邀请码 → 注册商户 → 激活 → 创建客服 → 工作台配置（聊天/上传资料）→ 发布 → `/api-keys` 创建 sk 密钥接入。

### 本地开发（JS 本地跑 + 中间件容器化）

```bash
docker compose -f deploy/dev/docker-compose.yml up -d   # Postgres(5433)/Redis(6380)/Langfuse(3000)
npm install && cp .env.example .env
npm run db:migrate
npm run dev:api &   # :4001
npm run dev:worker &
npm run dev:web &   # :5173（/api、/v1 代理）
```

### 端到端示例（王者荣耀）

见 `e2e-package/`：`王者荣耀-客服资料包.zip`（含故意留白）→ 工作台上传 → 按聊天引导补齐 → 自动发布；运行时用例与 curl 助手见 `e2e-package/测试用例.md` 与 `run-chat-test.sh`（正常回答 / 联网搜索 / 转人工 / 不完整输入等待 / 边界拒绝六类用例）。

---

## 5. 安全要点（已实现）

- 密码 Argon2id；会话 HMAC HttpOnly Cookie；管理员独立会话；**管理员停用商户后其会话与 Key 立即失效**（API 层强制）。
- 未激活商户 API 层禁止创建客服；邀请码哈希存储 + 事务核销。
- API Key 仅存哈希（sk + 16 位随机字符）、可删除、绑定客服；平台 LLM Key AES-256-GCM 加密仅显掩码。
- Agent 文件访问：`virtualMode` 虚拟根 + 存储层双围栏；运行时无写入/无 Shell/无子代理；web_fetch 带 SSRF 防护（内网/环回/重定向拦截）。
- 管理员关键操作全量审计；trace 与日志不含明文密钥。

## 6. 已知事项

1. Langfuse trace 的 `session_id` 聚合需用 OTel baggage 进一步传递（当前以 metadata 关联）。
2. 自托管 Langfuse 需 `LANGFUSE_MIGRATION_V4_WRITE_MODE=dual`（compose 已内置）。
3. 测试台在 API 进程内执行（与生产共用 Agent 核心），低频使用无碍。
4. PDF 解析依赖文本层，扫描件标记失败并引导粘贴关键内容；图片不做 OCR。
5. 模型偶发不调 `response` 时降级采用最后成文本并打 `response_contract_degraded` 标记。
6. 登录/注册 IP 限流未实现，公网部署建议 nginx 层补充。
7. `docker compose down -v` 删除数据卷；备份至少覆盖 postgres/clickhouse/minio/app-storage 四个卷。
