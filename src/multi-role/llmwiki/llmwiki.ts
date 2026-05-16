/**
 * LLMWiki — 每個角色的自治知識維基
 *
 * 設計理念:
 * - 每個角色有一個獨立的 Wiki 命名空間
 * - Wiki 以 Markdown 分層目錄結構組織
 * - 支援讀取、寫入、版本追蹤
 * - 與 RAG 知識庫無縫集成（Wiki 內容自動向量化）
 * - 跨角色知識共享（透過 wiki 連結引用）
 *
 * 目錄結構:
 * .claude/llmwiki/
 *   {role}/
 *     index.md          ← 角色 Wiki 首頁（總覽、核心能力、工作原則）
 *     knowledge/        ← 知識頁面（從 RAG 知識庫索引）
 *     methods/          ← 方法論頁面（工作流程、最佳實踐）
 *     projects/         ← 專案頁面（當前專案背景、進展）
 *     decisions/        ← 決策記錄（關鍵決策、權衡分析）
 *     references/       ← 參考資料（外部鏈接、相關文檔）
 */

import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { getCwd } from '../../utils/cwd.js'
import { ROLE_CATALOG } from '../types.js'
import { addKnowledge } from '../knowledge-base/engine.js'
import { recordDecision } from '../knowledge-base/knowledge-graph.js'

// ─── Types ───────────────────────────────────────────

export interface WikiPage {
  /** Page title */
  title: string
  /** Page content (Markdown) */
  content: string
  /** Category (knowledge, methods, projects, decisions, references) */
  category: string
  /** When the page was created */
  createdAt: string
  /** When the page was last updated */
  updatedAt: string
  /** Role that owns this page */
  roleId: string
  /** Version number */
  version: number
}

export interface WikiSearchResult {
  page: WikiPage
  relevance: number
  snippet: string
}

// ─── Path Management ─────────────────────────────────

function getWikiRoot(): string {
  return join(getCwd(), '.claude', 'llmwiki')
}

function getRoleWikiDir(roleId: string): string {
  return join(getWikiRoot(), roleId)
}

const WIKI_CATEGORIES = ['knowledge', 'methods', 'projects', 'decisions', 'references'] as const

// ─── Core API ────────────────────────────────────────

/** Initialize the LLMWiki for a specific role */
export function initRoleWiki(roleId: string): { success: boolean; message: string } {
  const meta = ROLE_CATALOG[roleId]
  if (!meta) {
    return { success: false, message: `未知角色: ${roleId}` }
  }

  const wikiDir = getRoleWikiDir(roleId)
  mkdirSync(wikiDir, { recursive: true })

  // Create category subdirectories
  for (const cat of WIKI_CATEGORIES) {
    const catDir = join(wikiDir, cat)
    if (!existsSync(catDir)) {
      mkdirSync(catDir, { recursive: true })
    }
  }

  // Create index.md if not exists
  const indexPath = join(wikiDir, 'index.md')
  if (!existsSync(indexPath)) {
    const indexContent = `# ${meta.roleName} Wiki

## 角色身份
- **名稱**: ${meta.roleName}
- **ID**: ${roleId}
- **描述**: ${meta.description}
- **類型**: ${meta.category === 'decision' ? '決策層' : meta.category === 'product' ? '產品層' : '執行層'}
- **知識庫優先級**: ${meta.knowledgePriority === 'must' ? '必需' : meta.knowledgePriority === 'suggested' ? '建議' : '無需'}

## 核心能力
（根據使用經驗持續更新）

## 工作原則
1. 始終以用戶目標為導向
2. 輸出質量優先於速度
3. 決策有據，記錄原因
4. 持續學習，更新Wiki

## 專案歷史
（自動記錄參與的專案和任務）
`
    writeFileSync(indexPath, indexContent, 'utf-8')
  }

  return { success: true, message: `✅ ${meta.roleName} Wiki 已初始化` }
}

/** Initialize all role wikis */
export function initAllWikis(): string[] {
  const messages: string[] = []
  for (const roleId of Object.keys(ROLE_CATALOG)) {
    const result = initRoleWiki(roleId)
    messages.push(result.message)
  }
  return messages
}

/** Get or create a wiki page */
export function getWikiPage(
  roleId: string,
  category: string,
  title: string,
): WikiPage | null {
  const filePath = getPagePath(roleId, category, title)
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, 'utf-8')
    const stat = require('fs').statSync(filePath)
    return {
      title,
      content,
      category,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      roleId,
      version: 1, // TODO: git-based versioning
    }
  } catch {
    return null
  }
}

/** Write a wiki page (creates or updates) */
export function writeWikiPage(
  roleId: string,
  category: string,
  title: string,
  content: string,
): { success: boolean; message: string } {
  // Validate role exists
  if (!ROLE_CATALOG[roleId]) {
    return { success: false, message: `未知角色: ${roleId}` }
  }

  // Validate category
  if (!(WIKI_CATEGORIES as readonly string[]).includes(category)) {
    return { success: false, message: `未知分類: ${category}。有效分類: ${WIKI_CATEGORIES.join(', ')}` }
  }

  // Ensure role wiki exists
  initRoleWiki(roleId)

  const filePath = getPagePath(roleId, category, title)
  const dir = join(filePath, '..')
  mkdirSync(dir, { recursive: true })

  const isUpdate = existsSync(filePath)

  const pageContent = `---
title: "${title}"
role: "${roleId}"
category: "${category}"
created: ${isUpdate ? (getWikiPage(roleId, category, title)?.createdAt || new Date().toISOString()) : new Date().toISOString()}
updated: ${new Date().toISOString()}
---

${content}
`

  try {
    writeFileSync(filePath, pageContent, 'utf-8')

    // Also add to RAG knowledge base for vector search
    void addKnowledge('user+project', getKbCategoryForRole(roleId), content, `llmwiki:${roleId}/${category}/${title}`)

    // Phase 2: 寫入知識圖譜 (decision 類別)
    if (category === 'decisions') {
      void recordDecision(roleId, title, content).catch(() => {})
    }

    const action = isUpdate ? '更新' : '建立'
    return { success: true, message: `✅ ${action} Wiki 頁面: ${roleId}/${category}/${sanitizeFilename(title)}` }
  } catch (e) {
    return { success: false, message: `❌ 寫入失敗: ${e}` }
  }
}

/** Search across wiki pages for a role */
export function searchWiki(
  roleId: string,
  query: string,
  maxResults: number = 5,
): WikiSearchResult[] {
  const wikiDir = getRoleWikiDir(roleId)
  if (!existsSync(wikiDir)) return []

  const results: WikiSearchResult[] = []
  const queryTerms = query.toLowerCase().split(/\s+/)

  for (const cat of WIKI_CATEGORIES) {
    const catDir = join(wikiDir, cat)
    if (!existsSync(catDir)) continue

    try {
      const files = readdirSync(catDir).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const content = readFileSync(join(catDir, file), 'utf-8')
        const contentLower = content.toLowerCase()

        let score = 0
        for (const term of queryTerms) {
          if (contentLower.includes(term)) score++
        }

        if (score > 0) {
          const title = file.replace('.md', '')
          const page = getWikiPage(roleId, cat, title)
          if (page) {
            // Generate snippet
            const matchIndex = contentLower.indexOf(queryTerms[0])
            const snippetStart = Math.max(0, matchIndex - 50)
            const snippet = '...' + content.substring(snippetStart, snippetStart + 200) + '...'

            results.push({
              page,
              relevance: score / queryTerms.length,
              snippet,
            })
          }
        }
      }
    } catch { /* skip */ }
  }

  return results
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxResults)
}

/** List all wiki pages for a role */
export function listRoleWiki(roleId: string): string {
  const meta = ROLE_CATALOG[roleId]
  const wikiDir = getRoleWikiDir(roleId)
  if (!existsSync(wikiDir)) {
    return `${meta?.roleName || roleId} Wiki 尚未初始化。使用 /wiki init ${roleId} 初始化。`
  }

  const lines = [`# ${meta?.roleName || roleId} Wiki\n`]

  // Read index
  const indexPath = join(wikiDir, 'index.md')
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, 'utf-8')
    lines.push(indexContent.split('---\n').pop()?.trim() || '')
    lines.push('')
  }

  // List pages by category
  for (const cat of WIKI_CATEGORIES) {
    const catDir = join(wikiDir, cat)
    if (!existsSync(catDir)) continue
    const files = readdirSync(catDir).filter(f => f.endsWith('.md'))
    if (files.length === 0) continue

    lines.push(`## ${cat}`)
    for (const file of files) {
      const title = file.replace('.md', '')
      const page = getWikiPage(roleId, cat, title)
      const dateStr = page ? new Date(page.updatedAt).toLocaleDateString('zh-CN') : ''
      lines.push(`- [[${title}]] ${dateStr ? `(${dateStr})` : ''}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** List all wikis across roles */
export function listAllWikis(): string {
  const wikiRoot = getWikiRoot()
  if (!existsSync(wikiRoot)) {
    return 'LLMWiki 尚未初始化。使用 /wiki init-all 初始化所有角色Wiki。'
  }

  const lines = ['# LLMWiki 總覽\n']
  const roles = readdirSync(wikiRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  for (const roleId of roles) {
    const meta = ROLE_CATALOG[roleId]
    if (!meta) continue
    const wikiDir = getRoleWikiDir(roleId)

    let pageCount = 0
    for (const cat of WIKI_CATEGORIES) {
      const catDir = join(wikiDir, cat)
      if (existsSync(catDir)) {
        pageCount += readdirSync(catDir).filter(f => f.endsWith('.md')).length
      }
    }

    lines.push(`- **${meta.roleName}** (${roleId}): ${pageCount} 頁面 [${meta.category === 'decision' ? '決策' : meta.category === 'product' ? '產品' : '執行'}]`)
  }

  return lines.join('\n')
}

/** Get the wiki context prompt for injection into agent system prompt */
export function getWikiContextPrompt(roleId: string, taskDescription: string): string {
  const meta = ROLE_CATALOG[roleId]
  if (!meta) return ''

  const wikiDir = getRoleWikiDir(roleId)
  if (!existsSync(wikiDir)) return ''

  // Read the index for role identity
  const indexPath = join(wikiDir, 'index.md')
  let indexContent = ''
  if (existsSync(indexPath)) {
    indexContent = readFileSync(indexPath, 'utf-8').split('---\n').pop()?.trim() || ''
  }

  // Search for relevant methods and knowledge
  const relevantPages = searchWiki(roleId, taskDescription, 3)

  const parts: string[] = []

  if (indexContent) {
    parts.push(`# ${meta.roleName} LLMWiki\n\n${indexContent.substring(0, 500)}`)
  }

  if (relevantPages.length > 0) {
    parts.push('## 相關 Wiki 頁面')
    for (const result of relevantPages) {
      parts.push(`### ${result.page.title} (相關度: ${(result.relevance * 100).toFixed(0)}%)`)
      parts.push(result.page.content.substring(0, 500))
    }
  }

  return parts.join('\n\n')
}

// ─── Helpers ─────────────────────────────────────────

function getPagePath(roleId: string, category: string, title: string): string {
  const wikiDir = getRoleWikiDir(roleId)
  const filename = sanitizeFilename(title)
  return join(wikiDir, category, `${filename}.md`)
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_\s]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 100)
}

function getKbCategoryForRole(roleId: string): string {
  const map: Record<string, string> = {
    'brand-designer': 'brand_designer',
    'product-manager': 'product_manager',
    'sales-specialist': 'sales_specialist',
    'frontend-engineer': 'software_engineer',
    'backend-engineer': 'software_engineer',
  }
  return map[roleId] || 'general'
}
