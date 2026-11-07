# Honmono AI · 轻量 AI 客服

**一个把 Agent 当作"负责任员工"来培养的 AI 客服平台**——它主动学习你的业务、拿不准时主动求助人工、每一次对话都可追踪可评估。

不是"套壳聊天框"。Honmono 的核心是一套让 Agent 获得**完备上下文**、保持**能力边界**、并能**持续进化**的工程机制。

> 配套 14 张端到端截图见 [`docs/screenshots/`](docs/screenshots/)（王者荣耀示例全旅程）；
> 可复现的示例资料包与测试用例见 [`e2e-package/`](e2e-package/)。

---

## 设计思想

### 一、Agent 是主动的负责人，不是问卷填写者

大多数客服搭建流程是"填表 → 生成"；Honmono 的配置 Agent 被设计为**一名主动了解企业的入职员工**：

- **自主取证优先**。商户给出台词级线索（官网、产品名）时，Agent 先用 `web_search` / `web_fetch` 自行取证——抓产品介绍、功能与定价页，将结论连同来源 URL、抓取时间、置信度写入 `references/research-notes.md`。实测中它甚至能识别"cloudpilot.example.com 是保留示例域名"并主动排查公网同名产品以防张冠李戴。
- **缺口驱动采访**。它只问自己查不到的事：能归纳为选项的用 `ask_user` 工具渲染成**点选卡片**（每轮 1-3 题），开放式问题才直接文字提问；拒绝过的问题绝不追问第三次。
- **上下文完备度是硬指标**。`references/` 下按职责拆分知识文件（company / products / policies / faq / conversation-rules），`validate_skill` 做确定性校验（结构 / 占位符 / 死链 / 空文件），P0 未满足不得发布——**宁可 unknown + 转人工，绝不编造**。
- **随时可打断**。商户补充信息时，正在工作的 Agent 在模型/工具调用边界被秒级中断，新任务携带完整历史接手——协作像同事，不像排队。

### 二、Human-in-the-loop 是日常协作，不是最后的兜底

- **主动求助**。Agent 遇到三类信号会立刻转人工：知识库无法确认的事实、客户情绪升级、客户明确要求。转人工不是丢一句话，而是带着**求助原因 + 上下文摘要 + 3 条建议回复**来——AI 已经替人工想好了怎么开场。
- **经验教训结构化沉淀**。两处沉淀机制：`open-questions.md` 记录所有"需要商户拍板"的待确认清单（背景 / 问题 / 建议默认值），商户回答一次就固化进知识；人工接管台里**采纳建议回复 = 该条建议的正样本、人工改写 = 负样本**——每一次人工介入都在训练数据里留下痕迹（回流路径见 Evaluation 规划）。
- **边界即信任**。能力边界（代练拒绝、账号操作不代做、转人工渠道）由商户确认后写入 `conversation-rules.md`，运行时硬性遵守；拿不准的问题宁可等待补充（`response(text, sleep)`）或升级，不猜。

### 三、可观测、可评估，才能可持续

每一条对话从 API 受理到 Agent 每次模型调用、每次工具执行、每次转人工，全部落在 Langfuse 的一条 trace 里；`skill_version` / 模型 / 提供商配置版本随行记录——**任何一条回答都能复现"当时用了哪份知识、哪个模型"**。评估不是事后补丁，而是平台的一等公民（见 [Evaluation 规划](#evaluation-规划)）。

---

## 架构

```
apps/web        React + Vite + Tailwind（配置工作台 / 人工接管台 / API 看板 / 管理员后台）
apps/api        Hono REST（认证、配置、文件、Key、测试 SSE、公开 /v1、管理接口）
apps/worker     BullMQ Worker（配置 Agent、运行时 Agent、文件解析、sleep/取代、打断）
packages/
  contracts     Zod Schema 与共享类型
  db            Drizzle Schema + 服务层（Run 状态机 / 会话 / 模型与搜索解析 / 审计）
  agent         Deep Agents 工厂（受限工具 + response 契约 + 打断中间件 + 搜索路由 + Langfuse OTel）
  storage       本地存储适配器（路径围栏；接口保持，可切换 S3）
skills/
  create-customer-service   配置 Agent 的"岗位手册"（采访手册 / 就绪契约 / 输出契约 / 行业参考 / 校验脚本）
deploy/dev      开发 compose（本地 Node + 容器化中间件）
e2e-package     王者荣耀示例：资料包 zip + 测试用例 + 跑测脚本
```

**运行时形态**：`deepagents`（LangGraph）+ 固定加载当前 Skill 版本；文件工具经 `FilesystemBackend({ virtualMode: true })` 限定在版本目录内（实测拦截 `..` / `~` / symlink 逃逸）；运行时**没有**写入、Shell、子代理；转人工与回复走受契约约束的信号工具；配置 Agent 另有写入与 `validate_skill / publish_skill`（服务端确定性实现，Agent 无法绕过）。

---

## 功能地图

| 模块 | 能力 |
| --- | --- |
| 商户端 | 注册 / 邀请码激活 / 客服看板（自动生成名称与描述）/ 二次确认删除 |
| 配置工作台 | 聊天式配置 · `ask_user` 选择题卡片 · **zip 资料包上传**（自动解包逐个解析）· 多 Tab 文件编辑器（⌘S）· 自主联网研究 · 打断式协作 · 确定性校验发布（不可变版本 + 原子切换） |
| 测试台 | 与生产共用 Agent 核心的 SSE 实时事件时间线（`skill.loaded → tool.started → response.delta → done`）|
| 生产 API | 非流式 `POST /v1/.../chat`（request_id 幂等 / 增量消息 / sleep 等待补充 / 转人工终态）+ 消息增量拉取 + 内嵌 API 文档页 |
| 人工接管台 | 跨客服工单（原因 / 上下文摘要 / 建议回复一键选用）· 接管期间 AI 静默 · 交还恢复 · 待处理角标 |
| 管理后台 | 商户 / 客服 / 邀请码管理 · LLM Provider 与模型配置（Key 加密、连接测试、分场景默认）· 搜索服务（Brave/Exa 额度感知轮换）· 审计日志 |
| 可观测 | Langfuse 全链路 trace（模型 / 工具 / 版本 / 会话），见下文 |

---

## 端到端导览（王者荣耀示例）

上传 [`e2e-package/王者荣耀-客服资料包.zip`](e2e-package/)（内含故意留白），看 Agent 如何工作：

**上传资料包 → Agent 自主归纳**：zip 自动解包，5 份资料逐个解析归档。

![工作台与资料包](docs/screenshots/02-workbench-upload-zip.png)

**缺口采访**：Agent 读完后用 `ask_user` 卡片只问"它查不到、必须商户拍板"的事——称呼方案（连推荐理由都给好了）、语气、转人工渠道。

![ask_user 选项卡片](docs/screenshots/04-ask-user-card.png)

**编辑与发布**：草稿实时可查可改；通过校验后自动发布不可变版本，名称/描述同步生成。

![编辑器打开 SKILL.md](docs/screenshots/05-workbench-editor-skillmd.png)
![联网研究笔记](docs/screenshots/06-research-notes-preview.png)

**运行时**：测试台与生产 API 同核——知识内问题直答（648→7196 点券）、时效问题联网（KPL 赛程带来源 URL）、边界问题拒答、拿不准转人工（带建议回复）。

![测试台联网搜索](docs/screenshots/07-test-playground-websearch.png)
![人工接管台](docs/screenshots/09-handoff-center-pending.png)

**人工协作**：选用建议回复即恢复 AI；接管期间 AI 静默，人工回复实时可被玩家侧拉取。

![建议回复并恢复 AI](docs/screenshots/10-handoff-reply-resume.png)

**管理侧**：多商户隔离、模型与搜索服务配置、全量审计。

![管理后台概览](docs/screenshots/11-admin-overview.png)

更多截图（仪表盘 / Langfuse / 审计）见 [`docs/screenshots/`](docs/screenshots/)：`13-langfuse-traces.png`、`14-langfuse-trace-detail.png`（LangGraph span 树：模型调用、token 用量、工具参数与返回）、`08`、`12`。

---

## Langfuse 集成

- **接入**：`@langfuse/langchain` CallbackHandler（**每 Run 独立实例**防并发串线）+ `@langfuse/tracing` 隔离 TracerProvider（`setLangfuseTracerProvider` 注入，规避 npm 多实例），OTLP 导出到自托管 Langfuse v4。
- **覆盖**：`configuration.run` / `chat.request` / `test.run` 三类 trace；span 树含每次模型调用（token 用量、延迟）、每次工具调用（read_file 参数、web_search 命中、write_file 落盘）与中间件钩子；metadata 携带 `skill_version` / 模型 / provider 配置版本；`sessionId = serviceId:conversationId` 串联同会话多 Run。
- **自托管要点**：v4 迁移期需 `LANGFUSE_MIGRATION_V4_WRITE_MODE=dual`（两个 compose 已内置），否则 OTLP 事件不落 ClickHouse；`LANGFUSE_INIT_*` 首启自动建组织/项目/Key/用户；密钥只经环境变量注入，trace 无明文凭证。

## Evaluation 规划

trace 已具备评估所需全部原料（span 树、metadata、会话串联、scores 接口）。规划四条线，按序落地：

| 线 | 内容 | 依赖 |
| --- | --- | --- |
| **离线回归** | 从 trace 沉淀「玩家问题 → 理想回答」进 Langfuse **Datasets**（首批 50-100 条：充值/退款/账号/皮肤/赛事/边界六类）；改提示词/换模型/换 SKILL 版本后 dataset run 批量重放，命中"编造未知事实 / 政策越界 / 人设漂移"即阻断发布 | Langfuse Datasets |
| **在线 judge** | 对生产 trace 最终回复跑轻量评估：事实一致性（断言须有 knowledge 依据）、政策越界（不承诺未确认的退款/解封）、人设语气；分数以 `scores` 写回原 trace | Langfuse Scores |
| **人工标注** | 接管台处理结果即标注：采纳建议=正样本、人工改写=负样本（改写文本回流数据集）；Annotation Queue 每周抽样 30 条按"正确 / 兜底正确 / 编造 / 越界"四档打分，校准 judge | Langfuse Annotation |
| **运营指标** | 转人工率（按 skill_version / 类别下钻）、等待补充率、打断率、首答延迟 P50/P95、web_search 依赖率、供应商轮换触发率；新版本发布后 48h 自动 A/B（`skill_version` 已在 metadata 中） | Langfuse Dashboards |

---

## 快速开始

### Docker Compose 全量部署

```bash
cp .env.example .env    # 替换全部 <random> 密钥
docker compose --profile app up -d --build
# 应用入口： http://localhost:8080    Langfuse： http://localhost:3000
```

首次启动：迁移自动执行并创建初始管理员；Langfuse 由 `LANGFUSE_INIT_*` 自动建组织/项目/Key。随后：管理员配置模型与搜索服务 → 生成邀请码 → 商户注册激活 → 工作台配置 → 发布 → `/api-keys` 创建 sk 密钥接入。

### 本地开发

```bash
docker compose -f deploy/dev/docker-compose.yml up -d   # Postgres(5433)/Redis(6380)/Langfuse(3000)
npm install && cp .env.example .env && npm run db:migrate
npm run dev:api & npm run dev:worker & npm run dev:web &   # :4001 / :5173
```

### 王者荣耀端到端示例

见 [`e2e-package/`](e2e-package/)：上传资料包 zip → 按聊天引导补齐留白 → 自动发布；`测试用例.md` 含六类运行时用例（知识回答 / 联网搜索 / 转人工 / 不完整输入等待 / 边界拒绝）与 curl 助手 `run-chat-test.sh`。

---

## 安全要点

- 密码 Argon2id；HMAC HttpOnly Cookie；管理员独立会话；**停用商户后其会话与 Key 立即失效**（API 层强制）。
- 未激活商户 API 层禁止创建客服；邀请码哈希存储 + 事务核销防并发。
- API Key 仅存哈希；平台 LLM Key AES-256-GCM 加密仅显掩码。
- Agent 文件访问双围栏（`virtualMode` + 存储层校验）；运行时无写入/Shell/子代理；`web_fetch` 带 SSRF 防护。
- 管理员关键操作全量审计；trace 与日志不含明文密钥。

## 已知事项

1. Langfuse `session_id` 聚合需 OTel baggage 进一步传递（当前以 metadata 关联）。
2. 自托管 Langfuse 需 `LANGFUSE_MIGRATION_V4_WRITE_MODE=dual`（compose 已内置）。
3. 测试台在 API 进程内执行（与生产共用 Agent 核心），低频使用无碍。
4. PDF 解析依赖文本层，扫描件标记失败并引导粘贴关键内容；图片不做 OCR。
5. 模型偶发不调 `response` 时降级采用最后成文本并打 `response_contract_degraded` 标记。
6. 登录/注册 IP 限流未实现，公网部署建议 nginx 层补充。
7. `docker compose down -v` 删除数据卷；备份覆盖 postgres / clickhouse / minio / app-storage 四卷。
