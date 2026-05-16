/**
 * 自動知識學習器 — 從角色工作過程中自動提取和儲存知識
 *
 * 三種知識來源：
 * 1. WebSearch 結果 → 自動提取關鍵資訊入庫
 * 2. 任務完成結果 → 提取經驗教訓入 LLMWiki
 * 3. 用戶手動 /kb add → 直接添加
 *
 * 架構：
 * - 非侵入式：在現有流程中掛載，不影響核心功能
 * - 增量式：只在有新資訊時才更新知識庫
 * - 去重：避免重複儲存相同知識
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { addKnowledge, searchKnowledge } from './engine.js'
import { recordTaskCompletion, recordDecision } from './knowledge-graph.js'

// ─── Types ───────────────────────────────────────────

export interface LearningEvent {
  type: 'search_result' | 'task_completion' | 'user_feedback' | 'manual_add'
  roleId: string
  content: string
  source: string
  timestamp: string
  metadata?: Record<string, string>
}

// ─── Deduplication ───────────────────────────────────

const recentLearnings = new Map<string, number>() // content_hash → timestamp
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

function contentHash(text: string): string {
  // Simple hash for dedup
  let hash = 0
  for (let i = 0; i < Math.min(text.length, 500); i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `${hash}`
}

function isRecentlyLearned(text: string): boolean {
  const hash = contentHash(text)
  const lastTime = recentLearnings.get(hash)
  if (lastTime && Date.now() - lastTime < DEDUP_WINDOW_MS) {
    return true
  }
  recentLearnings.set(hash, Date.now())
  // Cleanup old entries
  if (recentLearnings.size > 1000) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS
    for (const [k, v] of recentLearnings) {
      if (v < cutoff) recentLearnings.delete(k)
    }
  }
  return false
}

// ─── Auto-Ingestion Pipeline ─────────────────────────

const ROLE_KB_CATEGORY: Record<string, string> = {
  'brand-designer': 'brand_designer',
  'product-manager': 'product_manager',
  'sales-specialist': 'sales_specialist',
  'operations-specialist': 'operations',
  'frontend-engineer': 'software_engineer',
  'backend-engineer': 'software_engineer',
  'qa-engineer': 'qa_engineer',
  'customer-service': 'customer_service',
  'finance-assistant': 'general',
  ceo: 'general',
}

/**
 * 從搜索結果中自動提取知識
 * 
 * 當角色使用 WebSearch 獲得結果後，
 * 分析結果文本，提取有價值的知識片段，
 * 自動添加到對應的知識庫分類中。
 */
export async function learnFromSearchResult(
  roleId: string,
  searchQuery: string,
  searchResults: string,
): Promise<{ learned: number; fragments: string[] }> {
  const fragments: string[] = []
  const category = ROLE_KB_CATEGORY[roleId] || 'general'

  // Split search results into paragraphs
  const paragraphs = searchResults
    .split(/\n\n+/)
    .filter(p => p.trim().length > 50 && p.trim().length < 2000)

  for (const para of paragraphs.slice(0, 5)) {
    // Skip if already recently learned
    if (isRecentlyLearned(para)) continue

    // Check if similar knowledge already exists in KB
    try {
      const existing = await searchKnowledge('user+project', category, para, 1)
      if (existing.length > 0 && (existing[0].similarity || 0) > 0.85) {
        continue // Very similar knowledge already exists
      }
    } catch {
      // If search fails, still try to add
    }

    const result = await addKnowledge(
      'user+project',
      category,
      para,
      `auto:websearch:${searchQuery}`,
    )
    if (result.success) {
      fragments.push(para.substring(0, 100))
    }
  }

  logForDebugging(
    `Auto-learner: ${roleId} learned ${fragments.length} fragments from search "${searchQuery}"`,
  )

  return { learned: fragments.length, fragments }
}

/**
 * 從任務完成結果中提取經驗教訓
 */
export async function learnFromTaskCompletion(
  roleId: string,
  taskTitle: string,
  taskResult: string,
): Promise<{ learned: boolean; summary: string }> {
  if (isRecentlyLearned(taskResult)) {
    return { learned: false, summary: '已存在相似知識' }
  }

  const category = ROLE_KB_CATEGORY[roleId] || 'general'
  const summary = taskResult.length > 500 ? taskResult.substring(0, 500) + '...' : taskResult

  const result = await addKnowledge(
    'user+project',
    category,
    `[任務經驗] ${taskTitle}\n${summary}`,
    `auto:task:${taskTitle}`,
  )

  // Phase 2: 寫入知識圖譜（fire-and-forget，不阻塞主流程）
  void recordTaskCompletion(roleId, taskTitle, summary).catch(() => {})

  return { learned: result.success, summary }
}

/**
 * 匯入外部知識源（URL、文件等）
 * 這是用戶手動觸發的自動學習
 */
export async function learnFromExternalSource(
  roleId: string,
  sourceType: 'url' | 'file' | 'text',
  source: string,
  content: string,
): Promise<{ learned: number; message: string }> {
  const category = ROLE_KB_CATEGORY[roleId] || 'general'

  const paragraphs = content
    .split(/\n\n+/)
    .filter(p => p.trim().length > 30)

  let count = 0
  for (const para of paragraphs.slice(0, 10)) {
    if (isRecentlyLearned(para)) continue
    const r = await addKnowledge('user+project', category, para, `import:${sourceType}:${source}`)
    if (r.success) count++
  }

  return {
    learned: count,
    message: `✅ 從 ${sourceType} "${source}" 自動學習了 ${count} 個知識片段`,
  }
}

/**
 * 從專案文件中自動建立知識庫
 * 掃描 .claude/llmwiki 和 .claude/agent-memory 中的變更
 */
export async function syncWikiToKnowledge(): Promise<{ total: number; details: string[] }> {
  const details: string[] = []
  let total = 0

  const wikiRoot = join(getCwd(), '.claude', 'llmwiki')
  if (!existsSync(wikiRoot)) {
    return { total: 0, details: ['LLMWiki 尚未初始化'] }
  }

  const { readdirSync: lsDir } = require('fs') as typeof import('fs')

  try {
    const roles = lsDir(wikiRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

    for (const roleId of roles) {
      const wikiDir = join(wikiRoot, roleId)
      const categories = ['knowledge', 'methods', 'decisions']
      let roleCount = 0

      for (const cat of categories) {
        const catDir = join(wikiDir, cat)
        if (!existsSync(catDir)) continue

        const files = lsDir(catDir).filter((f: { endsWith: (ext: string) => boolean }) => f.endsWith('.md'))
        for (const file of files) {
          try {
            const content = readFileSync(join(catDir, file), 'utf-8')
            // Skip frontmatter
            const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/)
            const body = bodyMatch ? bodyMatch[1].trim() : content.trim()

            if (body && !isRecentlyLearned(body)) {
              const r = await addKnowledge(
                'user+project',
                ROLE_KB_CATEGORY[roleId] || 'general',
                body,
                `llmwiki:${roleId}/${cat}/${file}`,
              )
              if (r.success) roleCount++
            }
          } catch { /* skip */ }
        }
      }

      if (roleCount > 0) {
        details.push(`${roleId}: ${roleCount} 頁面同步`)
        total += roleCount
      }
    }
  } catch (e) {
    details.push(`同步失敗: ${e}`)
  }

  return { total, details }
}

/**
 * 獲取學習統計
 */
export function getLearningStats(): string {
  const uniqueLearnings = recentLearnings.size
  return `📊 自動學習統計:\n  本次會話已學習: ${uniqueLearnings} 個片段\n  去重窗口: 24 小時`
}
