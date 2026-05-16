# AgentForge — 多智能體協作系統

一個運行在 macOS 上的 CLI 多智能體系統。CEO + 7 核心角色，Paperclip 式心跳狀態機 + 雙重品質閘，三層知識系統，9 Skills，KPI/觀察追蹤，lean-ctx Token 優化，MCP 桌面控制。

## Language

**CEO Agent**:
頂層調度角色 + 品管閘。不是傳話筒——必須親自驗證交付物才回報用戶。12 步心跳狀態機（Orient → Review → Team Status → Pre-Creation Gate → QC Gate → Delegation QC → Anti-Drift → Reporting → Feedback Loop → KPI → Observations → Memory）。Capability Fallback：當角色不可用時 CEO 接手其核心職責。系統提示詞位於 `.claude/agents/ceo.md`。
_Avoid_: 總控、master、orchestrator

**核心角色 (Base Roles)**:
CEO 派發任務的 7 個專職 Agent，不可移除。各有獨立系統提示詞 `.claude/agents/{role}.md`、6 步 worker heartbeat、anti-patterns 表。角色列表：product-manager、architect、project-manager、backend-engineer、frontend-engineer、qa-engineer、designer。
_Avoid_: worker、agent worker、slave、子角色

**三層知識系統**:
LLM Wiki → RAG (LanceDB) → Knowledge Graph (bellamem)。Layer 1 是結構化 Markdown 文檔，Layer 2 是語義向量搜尋 (384 維 all-MiniLM-L6-v2)，Layer 3 是實體關係推理 (漣漪影響分析)。
_Avoid_: 知識庫 (太模糊，說不清是第幾層)

**LLM Wiki**:
角色專屬的 Markdown 知識庫，位於 `.claude/llmwiki/{role}/`。6 個分類：knowledge/ methods/ projects/ decisions/ references/ + index.md。寫入後自動同步到 RAG。
_Avoid_: wiki、文檔庫

**RAG**:
基於 LanceDB + Xenova all-MiniLM-L6-v2 (384維) 的本地向量庫，位於 `.claude/knowledge-vectordb/`。chunk 策略：256 字元 + 64 字元重疊滑窗。支援 re-ranking (60% 向量相似度 + 40% 關鍵詞重疊)。透過 `sync-rag.ts` 操作。
_Avoid_: 向量庫、embedding DB

**知識圖譜 (Knowledge Graph)**:
基於 bellamem 的圖結構記憶，位於 `.claude/knowledge-graph.json`。概念分為 invariant(不變)/observation(觀察)/ephemeral(臨時) 三類，type 分為 skill/project/opportunity/task。核心功能：漣漪影響分析 (BFS 兩層)、技能→機會映射。
_Avoid_: graph、KG、圖

**MCP (Model Context Protocol)**:
工具協議層。本系統自建 Desktop MCP Server (8 工具，482 行，基於 osascript/screencapture/pbcopy)。註冊在 `.claude/mcp.json`。
_Avoid_: 工具層、plugin

**Desktop MCP**:
macOS 桌面控制。8 個工具：screenshot、click、type、key、open_app、applescript、clipboard、get_window_list。零外部依賴，全部用 macOS 內建指令。
_Avoid_: 桌面工具、macOS control

**sync-rag.ts**:
RAG 向量同步工具。`bun run sync-rag.ts` 重建向量庫，`bun run sync-rag.ts --search "查詢"` 語義搜尋，`bun run sync-rag.ts --status` 查看狀態。
_Avoid_: RAG sync、向量同步

**build-profile.ts**:
個人畫像生成器。分析 LLM Wiki 內容，生成技能分佈、領域深度、項目經驗等畫像。輸出到 `.claude/agent-memory/ceo/PROFILE.md`。
_Avoid_: profile builder、畫像生成

**個人畫像 (PROFILE)**:
自動生成的 CEO 技能/經驗畫像，位於 `.claude/agent-memory/ceo/PROFILE.md`。動態更新，反映 LLM Wiki 的當前狀態。
_Avoid_: resume、CV

**Skills 系統**:
輕量級、可組合的 Agent 行為提示詞，以 YAML frontmatter + Markdown 體存在 `.claude/skills/` 下。透過 `.claude-plugin/plugin.json` 註冊，由 Claude Code 載入為斜槓指令。目前 9 個技能：grill-with-docs、diagnose、caveman、handoff、to-prd、to-issues、tdd、improve-codebase-architecture、zoom-out。
_Avoid_: skill、plugin、自定義指令

**PRD (Product Requirements Document)**:
產品需求文檔。六節模板：問題陳述 → 解決方案 → 使用者故事 → 實作決策 → 測試決策 → 不在此範圍。由 to-prd 技能產生。
_Avoid_: spec、需求文檔

**垂直切片 (Vertical Slice / Tracer Bullet)**:
端到端穿透所有整合層（schema、API、UI、測試）的狹窄功能切片。每個切片可獨立示範/驗證。對立面是水平切片（逐層開發），視為反模式。
_Avoid_: feature slice、模組開發

**TDD (Test-Driven Development)**:
紅-綠-重構循環：先寫失敗測試 → 最小程式碼通過 → 重構。測試僅驗證公開介面的外部行為，不測試實作細節。每個循環一個垂直切片。
_Avoid_: 測試驅動 (太模糊)

**深層模組 (Deep Module)**:
大量功能封裝在一個簡單、穩定、可測試的介面背後。高槓桿 + 高局部性。對立概念：淺層模組——介面幾乎和實作一樣複雜。
_Avoid_: deep module、封裝模組

**Heartbeat 心跳狀態機**:
CEO 12 步、Worker 6 步的強制執行循環。CEO 心跳：Step 1-12，含 Pre-Creation Gate (4 問)、QC Gate (親自驗證)、Anti-Drift Check。Worker 心跳：Identity → Assignments → Execute → Self-Check → Complete → Exit。每步不可跳過。
_Avoid_: 流程、工作流

**QC Gate (品質閘)**:
CEO Step 4，MANDATORY。CEO 親自打開/讀取交付物，檢查 4a (完整性) + 4b (Red Flags: 不存在/明顯錯誤/佔位符/需求不符/KPI異常)。全部通過 → 回報用戶。任一失敗 → 退回角色。
_Avoid_: review、審核

**Pre-Creation Gate (任務創建前 4 問)**:
CEO Step 3.5。創建任何新任務前必須回答：1. 有驗收標準嗎？2. 交付物已存在嗎？3. 直接貢獻目標嗎？4. 用戶已批准嗎？任一「否」→ 不創建。閒置的部門 = 成功。
_Avoid_: 任務閥、creation check

**Capability Fallback (能力替補)**:
當某角色不可用時，CEO 接手其核心職責：PM 不在 → CEO 寫 PRD、Architect 不在 → CEO 做架構決策、Project Manager 不在 → CEO 拆任務、QA 不在 → CEO 做最終驗收。Fallback KPI 同時記錄在 CEO 和被替代角色名下。
_Avoid_: 替補、backup

**KPI 系統**:
團隊績效追蹤。位於 `.claude/agent-kpi/`。主表 `kpi-log.md` (每行：Timestamp, Agent, Task, Done, Self, Tokens, Dur, Errs, Notes) + 各角色分表 `by-agent/{role}.md`。Worker Complete 步驟必須回報 KPI 自評，CEO Step 10 記錄。
_Avoid_: 績效、metrics

**Observations 系統**:
CEO 的觀察日誌。位於 `.claude/agent-kpi/observations.md`。OBS-{N} 格式記錄：連續 3 次類似錯誤、KPI 趨勢異常、新 Anti-Pattern。由 Step 9 (用戶糾錯) 或 Step 11 (CEO 觀察) 觸發，兩者共用同一份日誌並觸發 AGENTS.md anti-patterns 更新。
_Avoid_: 觀察記錄、pattern log

**Anti-Patterns**:
每個 Worker Agent 的 AGENTS.md 中的已知錯誤表。由 CEO Step 9.2 和 Step 11 共同更新。格式：錯誤 | 原因 | 檢查項。CEO 在派發任務時 (Step 5) 根據 observations 提醒角色注意相關反模式。
_Avoid_: 錯誤模式、bad practices

**lean-ctx**:
Rust binary MCP server + shell hooks，提供 Token 優化（60-95% 節省）。58 MCP 工具、10 種讀取模式。以 hybrid 模式整合進 Claude Code。對 agent 透明——無需顯式調用。
_Avoid_: token optimizer、上下文壓縮

**Feedback Loop (回饋閉環)**:
CEO Step 9。用戶指出錯誤後執行：1. 識別根因 → 2. 更新角色 AGENTS.md anti-patterns → 3. 記錄 Observation → 4. 更新 PROJECT-INVENTORY → 5. 驗證修復 → 6. 寫入 MEMORY.md。規則：犯一次是 bug、犯兩次是流程問題、犯三次是指令不夠清楚。
_Avoid_: 糾錯、修正流程

## Relationships

- **CEO Agent** 派發任務給 **核心角色**，執行 **Heartbeat 心跳狀態機** (12 步)
- **核心角色** 各自執行 Worker Heartbeat (6 步) → Self-Check 後回報 CEO + KPI 自評
- **CEO** Step 4 **QC Gate** 親自驗證所有交付物 → 通過才回報用戶
- **CEO** Step 5 派發時根據 **Observations** 和 **Anti-Patterns** 提醒角色注意
- **CEO** Step 9 **Feedback Loop** 和 Step 11 **Observations** → 更新角色 **AGENTS.md anti-patterns** 和 `.claude/agent-kpi/observations.md`
- **Worker** Complete 步驟 → 回報 KPI 自評 → **CEO** Step 10 寫入 **KPI 系統** (`kpi-log.md` + `by-agent/{role}.md`)
- **CEO** Step 1 Orient → 讀取 **KPI 系統** + **Observations** → 驅動 Step 3 Team Status 和 Step 5 Delegation
- **CEO** Capability Fallback → 接手不可用角色的職責 → KPI 雙重記錄
- **核心角色** 讀寫各自 **LLM Wiki**
- **LLM Wiki** 寫入 → 自動觸發 **RAG** 同步
- **RAG** 搜尋 → re-ranking (60% 向量 + 40% 關鍵詞)
- **知識圖譜** → 漣漪影響分析 (BFS 兩層) + 技能→機會映射
- **Desktop MCP** → 註冊在 `.claude/mcp.json`
- **lean-ctx** → MCP server + shell hooks → 透明 Token 優化 (60-95%)
- **sync-rag.ts** → 從 **LLM Wiki** 重建 **RAG** 向量
- **build-profile.ts** → 分析 **LLM Wiki** → 輸出 **個人畫像**
- **Skills 系統** 透過 `.claude-plugin/plugin.json` 註冊 → Claude Code 載入為斜槓指令
- **to-prd** → 產生 **PRD** → **to-issues** → 產生 **垂直切片** issues
- **TDD** → 每個循環產出一個 **垂直切片** (紅→綠→重構)
- **improve-codebase-architecture** → 將淺層模組重構為 **深層模組**
- **CEO** Step 5 中 Skills-to-Role 映射：PM→to-prd, Architect→zoom-out, PM→to-issues, Engineers→tdd, QA→grill-with-docs

## Example dialogue

> **User:** 「幫我做一個任務管理 App」
> **CEO Agent:** 「[Step 1] Read CONTEXT.md → [Step 2] 檢查團隊狀態 → [Step 3.5] Pre-Creation Gate 4 問通過 → [Step 5] 派發 PM 寫 PRD (含 to-prd skill) → PM Complete + KPI 自評 → [Step 4] QC Gate 審 PRD → 派發 Architect 設計架構 → ... → 最終 QC Gate 親自驗證 → [Step 7] CEO BRIEFING 回報」

> **User:** 「QA 連續 3 次漏測了登入功能」
> **CEO Agent:** 「[Step 11] 記錄 Observation (OBS-001) → 更新 qa-engineer.md Anti-Patterns 表 → [Step 9.2] 在 qa-engineer AGENTS.md 加入『跳過登入流程測試』為 anti-pattern → 下次派發 QA 時 (Step 5) 在 prompt 中提醒」

## Flagged ambiguities

- 「知識庫」曾被用於指 LLM Wiki、RAG、或整個三層系統 — 已解決：必須指明是「LLM Wiki」「RAG 向量庫」或「知識圖譜」。
- 「Agent」曾被用於指 CEO、核心角色、或整個 Claude Code — 已解決：上下文裡「CEO」指調度層，「核心角色」指執行層，「Claude Code」指整個終端工具。
- 「AgentForge」vs「03-claude-code-runnable」— 前者是對外展示名，後者是本地目錄名，指的是同一個系統。
- 「skill」一詞歧義 — 在 Skills 系統上下文中指 Agent 行為提示詞（`.claude/skills/` 下的 SKILL.md）；在其他上下文可能指開發者技能或 AI 能力。必須根據上下文區分。
- 「PM」一詞歧義 — 在 8 角色體系中，Product Manager（產品經理）和 Project Manager（專案經理）是兩個不同角色。必須使用全稱或分別簡稱為「Product Manager」「Project Manager」，不可混用「PM」。
- 「完成」一詞歧義 — Worker 說「完成」指自檢通過並回報 CEO；CEO 說「完成」指 Step 4 QC Gate 親自驗證通過。用戶只應看到 CEO 級別的「完成」。
