# 文件规范化（file-normalization）

上传文件由服务端解析后写入草稿 `references/source-{uploadId}.md`，并更新 `references/source-index.md`。本文件指导你如何使用解析结果。

## 解析状态含义
| parse_status | 含义 | 你的动作 |
| --- | --- | --- |
| parsed | 已生成文本副本 | read_file 读取 source-{uploadId}.md，归纳进对应 references |
| partial | 部分页/部分表解析成功 | 读取可用部分；缺口列入提问计划 |
| unsupported | 类型不支持或无法提取文本 | 不要求商户重新整理全部资料，只问最关键的内容 |
| failed | 解析失败 | 记入 unknown；在 response 中告知商户该文件不可读，请其粘贴关键内容 |

## 使用规则
1. 先读 `references/source-index.md` 了解全部文件与状态。
2. 只读取与当前缺口相关的文件；大文件先 grep 再 read。
3. 归纳事实时保留来源：`（来源：上传文件《价格表》第 3 节）`。
4. 文件内容与商户口述冲突时，以商户最新明确确认为准，并在 response 中指出冲突。
5. 图片不做 OCR；若运行时模型支持多模态可读取原件，否则仅记录元数据。不要假设能读取图片内容。

## source-index.md 格式（服务端维护，你可追加"适用范围/备注"列）
```
| uploadId | 文件名 | 状态 | 文本副本 | 摘要 |
```
