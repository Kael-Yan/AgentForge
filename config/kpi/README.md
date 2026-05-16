# Agent KPI Tracking System

每次 Agent 調用完成後，由 CEO 記錄 KPI。格式：Markdown Table。

## KPI 指標

| 欄位 | 說明 | 取值範圍 |
|------|------|---------|
| timestamp | 記錄時間 | ISO 8601 |
| agent | 角色名 | ceo / product-manager / architect / project-manager / backend-engineer / frontend-engineer / qa-engineer / designer |
| taskId | 任務描述 | 簡短摘要 |
| taskCompleted | 是否完成 | ✅ / ❌ |
| selfAssessment | 自評分數 | 1-10 |
| tokensUsed | Token 消耗 | 數字 (估算) |
| durationSec | 執行時間 | 秒 |
| errorsEncountered | 錯誤數 | 數字 |
| notes | 備註 | 自由文字 |

## 檔案結構

```
.claude/agent-kpi/
├── README.md          ← 你正在看的
├── kpi-log.md         ← 全體 KPI 總表
├── by-agent/          ← 按角色分開的 KPI
│   ├── ceo.md
│   ├── product-manager.md
│   ├── architect.md
│   ├── project-manager.md
│   ├── backend-engineer.md
│   ├── frontend-engineer.md
│   ├── qa-engineer.md
│   └── designer.md
└── observations.md    ← CEO 觀察日誌
```
