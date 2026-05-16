/**
 * Lightweight Tool Registry
 *
 * Ported from Zero_token / FreeMind. Zero framework dependency.
 * Each tool is a pure async function with JSON Schema parameters.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs'
import { join, resolve, relative } from 'path'
import { execSync } from 'child_process'

// ─── Types ────────────────────────────────────────

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, { type: string; description: string; required: boolean; default?: string }>
  execute: (params: Record<string, string>) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  data: string
  error?: string
  metadata?: Record<string, any>
}

// ─── Registry ─────────────────────────────────────

const toolRegistry = new Map<string, ToolDef>()

export function registerTool(tool: ToolDef) {
  toolRegistry.set(tool.name, tool)
}

export function getTool(name: string): ToolDef | undefined {
  return toolRegistry.get(name)
}

export function listTools(): ToolDef[] {
  return Array.from(toolRegistry.values())
}

export async function executeToolCall(name: string, params: Record<string, string>): Promise<ToolResult> {
  const tool = toolRegistry.get(name)
  if (!tool) return { success: false, data: '', error: `Unknown tool: ${name}` }
  return tool.execute(params)
}

// ─── Tool: read_file ──────────────────────────────

registerTool({
  name: 'read_file',
  description: 'Read the full content of a file.',
  parameters: {
    path: { type: 'string', description: 'File path (absolute or relative)', required: true },
  },
  async execute(params) {
    try {
      const fullPath = resolve(params.path)
      if (!existsSync(fullPath)) {
        return { success: false, data: '', error: `File not found: ${fullPath}` }
      }
      const s = statSync(fullPath)
      if (s.isDirectory()) {
        return { success: false, data: '', error: `Path is a directory: ${fullPath}` }
      }
      const content = readFileSync(fullPath, 'utf-8')
      return {
        success: true,
        data: s.size > 100_000 ? content.substring(0, 100_000) + '\n...(truncated)' : content,
        metadata: { path: fullPath, size: s.size, lines: content.split('\n').length },
      }
    } catch (e: any) {
      return { success: false, data: '', error: e.message }
    }
  },
})

// ─── Tool: list_dir ───────────────────────────────

registerTool({
  name: 'list_dir',
  description: 'List files and subdirectories in a directory. Supports glob pattern filtering.',
  parameters: {
    path: { type: 'string', description: 'Directory path', required: false, default: '.' },
    pattern: { type: 'string', description: 'Glob filter e.g. *.ts, **/*.md', required: false, default: '*' },
  },
  async execute(params) {
    try {
      const dir = resolve(params.path || '.')
      if (!existsSync(dir)) return { success: false, data: '', error: `Directory not found: ${dir}` }
      const s = statSync(dir)
      if (!s.isDirectory()) return { success: false, data: '', error: `Not a directory: ${dir}` }

      const pattern = params.pattern || '*'
      const results: string[] = []
      const MAX = 200

      function walk(current: string, depth: number = 0) {
        if (results.length >= MAX || depth > 5) return
        try {
          for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (results.length >= MAX) break
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
            const full = join(current, entry.name)
            const rel = relative(dir, full)
            if (entry.isDirectory()) {
              if (pattern === '*' || matchGlob(rel, pattern)) results.push(`${rel}/`)
              if (pattern.includes('**') || pattern === '*') walk(full, depth + 1)
            } else if (matchGlob(rel, pattern)) {
              results.push(rel)
            }
          }
        } catch {}
      }

      walk(dir)
      return {
        success: true,
        data: results.length > 0 ? results.sort().join('\n') : `(empty: ${dir})`,
        metadata: { path: dir, count: results.length, truncated: results.length >= MAX },
      }
    } catch (e: any) {
      return { success: false, data: '', error: e.message }
    }
  },
})

function matchGlob(name: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '**') return true
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  )
  return regex.test(name)
}

// ─── Tool: search_content ─────────────────────────

registerTool({
  name: 'search_content',
  description: 'Search text or regex in file contents. Like grep.',
  parameters: {
    pattern: { type: 'string', description: 'Text or regex to search for', required: true },
    path: { type: 'string', description: 'Directory to search', required: false, default: '.' },
    file_types: { type: 'string', description: 'Limit file types e.g. .ts,.md', required: false, default: '' },
    max_results: { type: 'string', description: 'Max results', required: false, default: '30' },
  },
  async execute(params) {
    try {
      const dir = resolve(params.path || '.')
      const max = parseInt(params.max_results || '30')
      const extensions = params.file_types ? params.file_types.split(',').map(s => s.trim()) : []
      const isRegex = params.pattern.startsWith('/') && params.pattern.endsWith('/')
      const regex = isRegex
        ? new RegExp(params.pattern.slice(1, -1), 'gi')
        : new RegExp(params.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

      const results: string[] = []

      function walk(current: string, depth: number = 0) {
        if (results.length >= max || depth > 5) return
        try {
          for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (results.length >= max) break
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
            const full = join(current, entry.name)
            if (entry.isDirectory()) {
              walk(full, depth + 1)
            } else if (extensions.length === 0 || extensions.some(ext => entry.name.endsWith(ext))) {
              try {
                const content = readFileSync(full, 'utf-8')
                const lines = content.split('\n')
                for (let i = 0; i < lines.length && results.length < max; i++) {
                  if (regex.test(lines[i])) {
                    regex.lastIndex = 0
                    results.push(`${relative(dir, full)}:${i + 1}: ${lines[i].trim().substring(0, 120)}`)
                  }
                }
              } catch {}
            }
          }
        } catch {}
      }

      walk(dir)
      return {
        success: true,
        data: results.length > 0 ? results.join('\n') : `No matches for "${params.pattern}"`,
        metadata: { pattern: params.pattern, dir, count: results.length },
      }
    } catch (e: any) {
      return { success: false, data: '', error: e.message }
    }
  },
})

// ─── Tool: write_file ─────────────────────────────

registerTool({
  name: 'write_file',
  description: 'Write content to a file.',
  parameters: {
    path: { type: 'string', description: 'Target file path', required: true },
    content: { type: 'string', description: 'Content to write', required: true },
  },
  async execute(params) {
    try {
      const fullPath = resolve(params.path)
      const dir = join(fullPath, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(fullPath, params.content)
      return {
        success: true,
        data: `Written ${fullPath} (${params.content.length} chars)`,
        metadata: { path: fullPath, size: params.content.length },
      }
    } catch (e: any) {
      return { success: false, data: '', error: e.message }
    }
  },
})

// ─── Tool: web_fetch ──────────────────────────────

registerTool({
  name: 'web_fetch',
  description: 'Fetch web page content and extract text. Good for docs, API references, articles.',
  parameters: {
    url: { type: 'string', description: 'URL to fetch', required: true },
  },
  async execute(params) {
    try {
      const url = params.url
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, data: '', error: `Invalid URL: ${url}` }
      }
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'AgentForge/2.0' },
        signal: AbortSignal.timeout(15000),
      })
      if (!resp.ok) return { success: false, data: '', error: `HTTP ${resp.status}` }
      const html = await resp.text()
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000)
      return { success: true, data: text, metadata: { url, chars: text.length } }
    } catch (e: any) {
      return { success: false, data: '', error: e.message }
    }
  },
})

// ─── Tool: web_search ─────────────────────────────

registerTool({
  name: 'web_search',
  description: 'Search the web using DuckDuckGo and return results. Free, no API key needed.',
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
    max_results: { type: 'string', description: 'Max results (default 10)', required: false, default: '10' },
  },
  async execute(params) {
    try {
      const query = encodeURIComponent(params.query)
      const max = parseInt(params.max_results || '10')
      const url = `https://html.duckduckgo.com/html/?q=${query}`

      const resp = await fetch(url, {
        headers: { 'User-Agent': 'AgentForge/2.0' },
        signal: AbortSignal.timeout(10000),
      })
      if (!resp.ok) return { success: false, data: '', error: `HTTP ${resp.status}` }

      const html = await resp.text()
      const results: string[] = []

      // Parse DuckDuckGo HTML results
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
      let match
      let count = 0

      while ((match = resultRegex.exec(html)) !== null && count < max) {
        const href = match[1]
        const title = match[2].replace(/<[^>]+>/g, '').trim()
        const snippet = match[3].replace(/<[^>]+>/g, '').trim()

        if (href && title && !href.includes('duckduckgo.com')) {
          count++
          results.push(`${count}. **${title}**\n   ${snippet}\n   ${href}`)
        }
      }

      if (results.length === 0) {
        // Fallback: try simpler parsing
        const linkRegex = /<a[^>]*class="result__url"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
        const titleRegex = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/gi
        const links: string[] = []
        let lm
        while ((lm = linkRegex.exec(html)) !== null && links.length < max) {
          links.push(lm[1])
        }
        if (links.length > 0) {
          results.push(`Found ${links.length} links:\n${links.map((l, i) => `${i + 1}. ${l}`).join('\n')}`)
        } else {
          results.push('No results found. Try a different query.')
        }
      }

      return {
        success: true,
        data: results.join('\n\n'),
        metadata: { query: params.query, count: results.length },
      }
    } catch (e: any) {
      return { success: false, data: '', error: e.message }
    }
  },
})
