/**
 * 知识库引擎 — RAG 向量檢索版
 *
 * 使用 LanceDB (vectordb) 本地向量數據庫 + Xenova Transformers 本地嵌入模型
 * M4 Mac mini CoreML 硬體加速
 *
 * 架構:
 * - 三層檢索: 通用知識庫 → 角色專屬知識庫 → 專案專屬知識庫
 * - 自動注入: 高優先級角色預設開啟，其餘預設關閉
 * - 開關粒度: 支援角色/專案級開關
 */

import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { getCwd } from '../../utils/cwd.js'
import { getMemoryBaseDir } from '../../utils/paths.js'
import { logForDebugging } from '../../utils/debug.js'
import { ROLE_CATALOG } from '../types.js'

// ─── Types ───────────────────────────────────────────

export interface KnowledgeEntry {
  text: string
  source: string
  createdAt: string
  tags?: string[]
  similarity?: number
}

export type KnowledgeScope = 'user' | 'project' | 'local' | 'user+project'

interface RAGConfig {
  /** Similarity threshold for injection (0-1) */
  similarityThreshold: number
  /** Max tokens for injected knowledge */
  maxTokens: number
  /** Max results per query */
  maxResults: number
  /** Per-role auto-inject toggle */
  roleAutoInject: Record<string, boolean>
}

// ─── Default Config ──────────────────────────────────

const DEFAULT_RAG_CONFIG: RAGConfig = {
  similarityThreshold: 0.5,
  maxTokens: 2000,
  maxResults: 5,
  roleAutoInject: {},
}

// Auto-inject configuration based on knowledge priority
for (const [roleId, meta] of Object.entries(ROLE_CATALOG)) {
  DEFAULT_RAG_CONFIG.roleAutoInject[roleId] = meta.defaultAutoInject
}

// ─── Lazy initialization ─────────────────────────────

let ragConfig: RAGConfig = { ...DEFAULT_RAG_CONFIG }
let dbInstance: any = null
let embedderInstance: any = null
let initPromise: Promise<void> | null = null

const DB_PATH = join(getCwd(), '.claude', 'knowledge-vectordb')

/** Initialize LanceDB and embedding model */
async function ensureInit(): Promise<void> {
  if (dbInstance && embedderInstance) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      // Dynamic import — only load when actually used
      const { connect } = await import('vectordb')
      dbInstance = await connect(DB_PATH)
      logForDebugging(`LanceDB connected at ${DB_PATH}`)

      // Initialize embedding model lazily
      const { pipeline } = await import('@xenova/transformers')
      embedderInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true,
      })
      logForDebugging('Embedding model loaded (all-MiniLM-L6-v2)')
    } catch (e) {
      logForDebugging(`Knowledge base init failed: ${e}, falling back to file-based mode`)
      // Fallback: dbInstance stays null, will use file-based search
      dbInstance = null
      embedderInstance = null
    }
  })()

  return initPromise
}

/** Reset the engine (for testing/reload) */
export function resetKnowledgeEngine(): void {
  dbInstance = null
  embedderInstance = null
  initPromise = null
}

// ─── Embedding ───────────────────────────────────────

/** Generate embedding vector for text */
async function embedText(text: string): Promise<number[]> {
  await ensureInit()
  if (!embedderInstance) {
    throw new Error('Embedding model not available')
  }
  const output = await embedderInstance(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data) as number[]
}

// ─── Table Management ────────────────────────────────

const ROLE_TABLE_MAP: Record<string, string> = {
  'brand-designer': 'kb_brand_designer',
  'product-manager': 'kb_product_manager',
  'sales-specialist': 'kb_sales_specialist',
  'operations-specialist': 'kb_operations',
  'frontend-engineer': 'kb_software_engineer',
  'backend-engineer': 'kb_software_engineer',
  'qa-engineer': 'kb_qa_engineer',
  'customer-service': 'kb_customer_service',
  'finance-assistant': 'kb_general',
  'personal-strategist': 'personal_strategy',
  'financial-planner': 'financial_planning',
  'freelance-consultant': 'freelancing',
  ceo: 'kb_general',
}

function getTableName(category: string): string {
  return ROLE_TABLE_MAP[category] || `kb_${category}`
}

/** Ensure a table exists in LanceDB */
async function ensureTable(tableName: string): Promise<any> {
  await ensureInit()
  if (!dbInstance) return null

  try {
    return await dbInstance.openTable(tableName)
  } catch {
    // Table doesn't exist, create it
    const table = await dbInstance.createTable(tableName, [
      {
        vector: Array(384).fill(0),
        text: '_init_',
        source: 'system',
        created_at: new Date().toISOString(),
      },
    ])
    // Delete the init row
    await table.delete('text = "_init_"')
    return table
  }
}

// ─── Public API ──────────────────────────────────────

/** Add knowledge to a category */
export async function addKnowledge(
  scope: KnowledgeScope,
  category: string,
  text: string,
  source: string = 'manual',
): Promise<{ success: boolean; message: string }> {
  try {
    const vector = await embedText(text)
    const tableName = getTableName(category)
    const table = await ensureTable(tableName)
    if (!table) {
      return { success: false, message: '❌ 向量數據庫未初始化。請先確保安裝了 vectordb 和 @xenova/transformers。' }
    }

    await table.add([
      {
        vector,
        text,
        source,
        created_at: new Date().toISOString(),
      },
    ])

    return { success: true, message: `✅ RAG知識已添加到 ${category}: ${text.substring(0, 50)}...` }
  } catch (e) {
    return { success: false, message: `❌ 添加失败: ${e}` }
  }
}

/** Import a Markdown file into a knowledge category */
export async function importMarkdownFile(
  scope: KnowledgeScope,
  category: string,
  filePath: string,
): Promise<{ success: boolean; message: string; count: number }> {
  try {
    const { readFileSync } = await import('fs')
    const content = readFileSync(filePath, 'utf-8')
    const sections = content.split(/^## /m).filter(s => s.trim())
    let count = 0

    for (const section of sections) {
      const lines = section.split('\n')
      const title = lines[0].trim()
      const body = lines.slice(1).join('\n').trim()

      if (body && body.length > 20) {
        const fullText = `## ${title}\n${body}`
        const result = await addKnowledge(scope, category, fullText, filePath)
        if (result.success) count++
      }
    }

    return {
      success: true,
      message: `✅ 已從 ${filePath} 導入 ${count} 個片段到 ${category} (RAG)`,
      count,
    }
  } catch (e) {
    return { success: false, message: `❌ 导入失败: ${e}`, count: 0 }
  }
}

/** Vector search knowledge base */
export async function searchKnowledge(
  scope: KnowledgeScope,
  category: string | null,
  query: string,
  limit: number = 5,
): Promise<KnowledgeEntry[]> {
  try {
    await ensureInit()

    if (!dbInstance || !embedderInstance) {
      // Fallback to file-based search
      return fileBasedSearch(scope, category, query, limit)
    }

    const queryVector = await embedText(query)
    const results: KnowledgeEntry[] = []

    // Determine categories to search
    const categories = category
      ? [category]
      : Object.keys(ROLE_TABLE_MAP)

    for (const cat of categories) {
      try {
        const tableName = getTableName(cat)
        const table = await dbInstance.openTable(tableName)

        const searchResults = await table
          .search(queryVector)
          .limit(limit)
          .toArray()

        for (const row of searchResults) {
          if (row._distance < ragConfig.similarityThreshold) continue
          results.push({
            text: row.text as string,
            source: `${cat}/${row.source || 'vector'}`,
            createdAt: (row.created_at as string) || new Date().toISOString(),
            tags: [cat],
            similarity: 1 - (row._distance as number),
          })
        }
      } catch {
        // Table doesn't exist yet, skip
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    return results.slice(0, limit)
  } catch (e) {
    logForDebugging(`Vector search failed: ${e}, falling back to file search`)
    return fileBasedSearch(scope, category, query, limit)
  }
}

/** File-based fallback search */
function fileBasedSearch(
  scope: KnowledgeScope,
  category: string | null,
  query: string,
  limit: number,
): KnowledgeEntry[] {
  const { readdirSync, existsSync: fexists, readFileSync } = require('fs') as typeof import('fs')
  const knowledgeDir = join(getCwd(), '.claude', 'knowledge')
  if (!fexists(knowledgeDir)) return []

  const results: KnowledgeEntry[] = []
  const queryTerms = query.toLowerCase().split(/\s+/)
  const categories = category ? [category] : readdirSync(knowledgeDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)

  for (const cat of categories) {
    const catDir = join(knowledgeDir, cat)
    if (!fexists(catDir)) continue
    try {
      const files = readdirSync(catDir).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const content = readFileSync(join(catDir, file), 'utf-8').toLowerCase()
        let score = 0
        for (const term of queryTerms) {
          if (content.includes(term)) score++
        }
        if (score > 0) {
          results.push({
            text: content.substring(0, 800),
            source: `${cat}/${file}`,
            createdAt: new Date().toISOString(),
            tags: [cat],
            similarity: score / queryTerms.length,
          })
        }
      }
    } catch { /* skip */ }
  }

  results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
  return results.slice(0, limit)
}

/** Generate knowledge injection prompt */
export function generateKnowledgePrompt(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) return ''

  return `
# 专业知识库 (RAG)
以下是检索到的相关专业知识，请严格基于这些知识来回答问题：

${entries.map((e, i) => `[知识片段 ${i + 1}] (相似度: ${((e.similarity || 0) * 100).toFixed(0)}%)
来源: ${e.source}
${e.text}
`).join('\n')}

如果知识库中没有相关内容，请明确说明，不要编造。基于可用知识给出最专业的回答。
`
}

/** Get knowledge for a specific role */
export async function getKnowledgeForRole(
  roleId: string,
  query: string,
  scope: KnowledgeScope = 'user+project',
): Promise<string> {
  // Check if auto-inject is enabled for this role
  const autoInject = ragConfig.roleAutoInject[roleId]
  if (autoInject === false) return ''
  if (autoInject === undefined) {
    // Default: high priority roles inject, others don't
    const meta = ROLE_CATALOG[roleId]
    if (!meta || meta.knowledgePriority === 'none') return ''
  }

  const categoryMap: Record<string, string> = {
    'brand-designer': 'brand_designer',
    'product-manager': 'product_manager',
    'sales-specialist': 'sales_specialist',
    'operations-specialist': 'kb_operations',
    'frontend-engineer': 'software_engineer',
    'backend-engineer': 'software_engineer',
    'qa-engineer': 'kb_qa_engineer',
    'customer-service': 'kb_customer_service',
    'finance-assistant': 'general',
    'personal-strategist': 'personal_strategy',
    'financial-planner': 'financial_planning',
    'freelance-consultant': 'freelancing',
    ceo: 'general',
  }

  const category = categoryMap[roleId]
  if (!category) return ''

  try {
    const results = await searchKnowledge(scope, category, query, 3)
    return generateKnowledgePrompt(results)
  } catch {
    return ''
  }
}

/** List knowledge categories */
export async function listKnowledge(scope: KnowledgeScope = 'user+project'): Promise<string> {
  await ensureInit()
  const lines: string[] = ['📚 知識庫概覽 (RAG 向量檢索):\n']
  const engineType = dbInstance ? 'LanceDB 向量數據庫' : '檔案模式 (未載入向量引擎)'
  lines.push(`引擎: ${engineType}`)
  lines.push(`相似度閾值: ${ragConfig.similarityThreshold}`)
  lines.push('')

  const autoInjectStatus: string[] = []
  for (const [roleId, enabled] of Object.entries(ragConfig.roleAutoInject)) {
    const meta = ROLE_CATALOG[roleId]
    if (meta) {
      autoInjectStatus.push(`  ${roleId} (${meta.roleName}): ${enabled ? '✅ 自動注入' : '❌ 手動'}`)
    }
  }
  lines.push('自動注入配置:')
  lines.push(...autoInjectStatus)
  lines.push('')

  if (dbInstance) {
    try {
      const tables = await dbInstance.tableNames()
      lines.push(`資料表: ${(tables as string[]).filter((t: string) => t.startsWith('kb_')).join(', ') || '(無)'}`)
    } catch { /* ignore */ }
  }

  return lines.join('\n')
}

/** Get current RAG config */
export function getRAGConfig(): RAGConfig {
  return { ...ragConfig }
}

/** Update RAG config */
export function updateRAGConfig(updates: Partial<RAGConfig>): void {
  ragConfig = { ...ragConfig, ...updates }
  if (updates.roleAutoInject) {
    ragConfig.roleAutoInject = { ...ragConfig.roleAutoInject, ...updates.roleAutoInject }
  }
}

/** Initialize knowledge base directories */
export function initKnowledgeBase(): void {
  const knowledgeDir = join(getCwd(), '.claude', 'knowledge')
  if (!existsSync(knowledgeDir)) {
    mkdirSync(knowledgeDir, { recursive: true })
  }
}
