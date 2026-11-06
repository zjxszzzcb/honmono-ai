# 就绪契约（readiness-contract）

## P0 必须（阻塞发布）
| 字段 | 存放位置 | 缺失处理 |
| --- | --- | --- |
| 客服身份（人设、称呼） | 草稿 SKILL.md 角色与身份 | 先问 |
| 公司／业务对象 | 草稿 SKILL.md 业务与产品 | 先问 |
| 主要产品或服务 | references/products.md | 先问 |
| 负责范围（处理什么、不处理什么） | 草稿 SKILL.md 服务范围与边界 | 先问；实在未知则默认"仅根据已有资料回答，其他转人工" |
| 人工兜底规则 | references/conversation-rules.md | 先问；商户不答则写入默认兜底：无法回答时建议用户联系人工并提供渠道占位 |

## P1 重要（不阻塞）
- 常见问题清单 → references/faq.md
- 价格／交付／退换／售后政策 → references/policies.md
- 服务时间、联系方式 → references/company.md
- 明确禁止事项 → references/conversation-rules.md

缺失时：相关事实标记 unknown，运行时客服对未知问题不得猜测，按兜底规则转人工。

## P2 增强（不阻塞）
- 语气人设细节、示例对话、品牌词、复杂产品细节、促销规则。
- 后续每轮配置都可以补充，不主动拉长首次配置。

## 保守兜底（写入 conversation-rules.md 的默认规则）
1. 知识中没有依据的问题：不编造，说明无法确认，建议人工渠道。
2. 涉及退款、封号、安全等敏感或高金额操作：核实订单信息后仍不确定的，转人工。
3. 用户要求人工：立即转人工，不挽留。
4. 服务范围外的问题：礼貌说明并引导回业务范围。

## 校验结果格式（validate_skill 返回）
```json
{
  "ok": true,
  "readiness": { "p0": {...每个字段 confirmed/unknown/deferred}, "p1": {...}, "p2": {...} },
  "blockers": ["缺少服务范围描述", "..."]
}
```
