# 输出契约（output-contract）

## 生成的客服 Skill 结构
草稿与发布版本的目录结构：

```
SKILL.md                       # 精炼指令＋资源索引（结构见主 SKILL.md）
references/
  company.md                   # 公司、品牌、服务对象、时间与联系方式
  products.md                  # 产品／服务与通用业务上下文
  policies.md                  # 价格、交付、退换、售后等已确认政策
  faq.md                       # 已确认问答与标准口径
  conversation-rules.md        # 详细服务边界与升级规则（必须含人工兜底）
  source-{uploadId}.md         # 每个可文本化上传文件的规范化副本（服务端写入）
  source-index.md              # 来源、解析状态、适用范围、更新时间（服务端写入）
assets/originals/              # 原始上传文件（服务端管理，不要修改）
```

## 写入规则
1. 只把**已确认的事实**写入对应文件；每条事实尽量标注来源（"商户 2026-11-07 确认"或"来自上传文件 xxx.md"）。
2. 未确认项写入 `unknown` 标记行，例如：`- 退款时效：unknown（商户暂未提供）`。
3. SKILL.md 保持精炼（不超过 60 行），细节全部放 references。
4. 资源索引中的每个条目必须真实存在，写明"何时读取"。
5. 不要创建本契约未列出的额外文件；不要修改 assets/originals 下的原件。

## 文件写作规范
- 使用 Markdown，标题层级从 `##` 开始（`#` 留给文件主标题）。
- 每个文件开头一行一句话说明该文件内容与更新时间。
- 问答类内容用 `### Q: ...\nA: ...` 格式，便于运行时检索。
- 表格类信息用 Markdown 表格。

## 运行时读取方式（写入 SKILL.md 资源索引时说明）
- 运行时客服固定加载 SKILL.md；细节按需 read_file。
- 大文件用 grep 定位关键词后 read_file 指定 offset/limit。
