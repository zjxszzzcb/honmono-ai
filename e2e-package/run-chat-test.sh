#!/bin/zsh
# 《王者荣耀》客服 · 聊天测试助手
# 用法: ./run-chat-test.sh "消息内容" [conversation_id]
# 环境变量: SVC（客服ID）、KEY（sk密钥）、API_BASE（默认 http://localhost:4001）
SVC=${SVC:-"<serviceId>"}
KEY=${KEY:-"<sk密钥>"}
API_BASE=${API_BASE:-"http://localhost:4001"}
MSG=${1:?"需要一条消息"}
CONV=${2:-"tc-$(date +%s)"}
RID=$(uuidgen)

curl -sS -X POST "$API_BASE/v1/customer-services/$SVC/chat" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"request_id\":\"$RID\",\"conversation_id\":\"$CONV\",\"messages\":[{\"role\":\"user\",\"content\":\"$MSG\"}]}" \
| python3 -c "
import json,sys
d=json.load(sys.stdin)
print('status:', d.get('status'))
print((d.get('message') or {}).get('content', json.dumps(d, ensure_ascii=False)))
"
