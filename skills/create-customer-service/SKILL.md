---
name: create-customer-service
description: 创建、补全、校验并发布商户 AI 客服 Skill。用于客服初始化、资料整理、配置采访、知识补充与规则更新。
---

# Create Customer Service

## 目标
把商户输入与文件整理成可运行、可追溯、不过度承诺的客服 Skill。
所有事实必须来自商户明确输入或上传资料；不知道就标记 unknown，禁止编造。

## 每次执行
1. 先读取当前草稿 `SKILL.md`、`references/` 下已有文件，了解已经确认了什么。
2. 判断公司与产品类别，只读取最相关的一份 `_guides/industry-*.md`（_guides 是服务端注入的采访指南目录：interview-playbook、readiness-contract、output-contract、file-normalization、industry-*。这些是给你看的规范，不是商户知识，不得写入发布索引）。
4. 合并已有事实，生成缺口列表；不要重复询问已经回答或被跳过的项。
5. 按 P0 → P1 → P2 排序。提问方式：能归纳为明确选项的用 ask_user 工具（每次 1-3 题，每题 2-6 个选项）；开放式问题直接写进 response。每轮最多 2 题。
6. 将确认信息写入草稿的 `SKILL.md`、`references/company.md`、`references/products.md`、`references/policies.md`、`references/faq.md`、`references/conversation-rules.md`。
7. 调用 validate_skill 查看就绪状态；P0 通过且尚未发布时调用 publish_skill 发布新版本，然后用 response 告知商户当前进展与下一个问题。
8. 注意：商户发送新消息会中断你的当前工作并由新一轮接手——因此每轮的文件写入要一次做完、保持完整，最后再输出问题。

## 采访约束
- 先利用文件和已有回答，再提问；不要把资料阅读变成商户的作业。
- 优先开放式问题，再给简短示例；一次不要跨多个主题。
- 用户拒绝、不知道或暂不回答时，记录 unknown／deferred 并继续。
- 不因追求"完整"而阻塞可用状态；缺少事实时使用保守回复与人工兜底。
- 高风险行业只补充边界问题，不生成诊断、承诺收益等专业规则。

## 草稿 SKILL.md 结构（生成的客服技能必须遵循）
```
---
name: <service-skill>
description: <一句话描述这个客服是谁、负责什么>
---

# <客服名称>

## 角色与身份
<你是谁、服务哪家公司/产品、语气人设>

## 业务与产品
<主要产品/服务概述；细节指向 references/products.md>

## 服务范围与边界
<负责什么、不负责什么；未知范围的处理原则>

## 核心规则
<最重要的服务规则与禁忌；详细规则指向 references/conversation-rules.md>

## 资源索引
- references/company.md — 公司与品牌信息
- references/products.md — 产品/服务详情
- references/policies.md — 价格、交付、退换、售后政策
- references/faq.md — 已确认问答
- references/conversation-rules.md — 服务边界与升级规则
- references/source-index.md — 上传资料索引
```

## 发布条件
- 草稿 SKILL.md 结构有效（frontmatter + 上述章节存在且非空）。
- P0 通过：角色与身份、业务与产品、服务范围三项已确认；conversation-rules.md 含人工兜底规则。
- references 至少包含 company.md 与 products.md（允许内容以"unknown"标注为主，但不得为空文件）。
- 发布由服务端事务完成（publish_skill 工具）；校验不通过时根据 blockers 继续补齐。

## 资源索引（本配置技能自带，供你学习采访与生成规范，不是商户内容）
- interview-playbook.md — 差距分析、提问顺序、追问与跳过策略
- readiness-contract.md — P0/P1/P2 字段、可用条件、保守兜底
- output-contract.md — 生成 Skill 的结构、索引与校验规则
- file-normalization.md — 文件分类、文本化、来源映射、失败处理
- industry-*.md — 各行业追问清单（只读最相关的一份）
