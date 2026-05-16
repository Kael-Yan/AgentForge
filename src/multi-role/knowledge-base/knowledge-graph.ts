/**
 * 知識圖譜層 — 基於 bellamem 的實體關係推理
 *
 * 在你多角色知識系統的上層，負責：
 * 1. 跨角色衝突檢測 — 前端改了 API，圖譜自動發現誰受影響
 * 2. 因果回溯 — 專案為什麼卡住？沿 blocks/cause 邊向上追溯
 * 3. 技能→機會映射 — 你現有技能能匹配什麼 Part-time／工作？
 *
 * 底層使用 bellamem 的 Graph (Concept + Edge) 結構。
 * 存儲位置: .claude/knowledge-graph.json
 */

import { join } from 'path'
import { existsSync } from 'fs'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import type { Graph, Concept, Edge, ConceptClass, EdgeType } from 'bellamem'

// ─── Types ────────────────────────────────────────────

export type KGNodeType =
  | 'role'
  | 'decision'
  | 'project'
  | 'skill'
  | 'task'
  | 'api'
  | 'opportunity'

export type KGRelationType =
  | 'depends_on'
  | 'affects'
  | 'uses'
  | 'requires'
  | 'blocks'
  | 'contradicts'
  | 'supports'
  | 'specializes'

export interface KGNodeInput {
  type: KGNodeType
  topic: string
  description?: string
  roleId?: string
}

export interface KGRelationInput {
  fromTopic: string
  toTopic: string
  type: KGRelationType
  confidence?: 'low' | 'medium' | 'high'
}

export interface ConflictResult {
  concept: string
  modifier: string
  affectedRoles: string[]
  severity: 'high' | 'medium' | 'low'
}

export interface CausalChain {
  topic: string
  chain: string[]
  blockers: string[]
}

// ─── Mappings ─────────────────────────────────────────

const NODE_TYPE_TO_CLASS: Record<KGNodeType, ConceptClass> = {
  role: 'invariant',
  decision: 'decision',
  project: 'invariant',
  skill: 'invariant',
  task: 'ephemeral',
  api: 'invariant',
  opportunity: 'observation',
}

const RELATION_TO_EDGE: Record<KGRelationType, EdgeType> = {
  depends_on: 'cause',
  affects: 'cause',
  uses: 'elaborate',
  requires: 'cause',
  blocks: 'dispute',
  contradicts: 'dispute',
  supports: 'support',
  specializes: 'elaborate',
}

// ─── Lazy bellamem ────────────────────────────────────

let _mod: {
  Graph: typeof Graph
  Concept: typeof Concept
  Edge: typeof Edge
  saveGraph: (g: Graph, p?: string) => string
  loadGraph: (p?: string) => Graph
  askText: (g: Graph, focus: string, opts?: Record<string, unknown>) => Promise<string>
  audit: (g: Graph) => Record<string, unknown>
  formatAudit: (r: Record<string, unknown>) => string
} | null = null

async function _bellamem() {
  if (_mod) return _mod
  const m = await import('bellamem')
  _mod = {
    Graph: m.Graph,
    Concept: m.Concept,
    Edge: m.Edge,
    saveGraph: m.saveGraph,
    loadGraph: m.loadGraph,
    askText: m.askText,
    audit: m.audit,
    formatAudit: m.formatAudit,
  }
  return _mod
}

// ─── Lifecycle ────────────────────────────────────────

const GRAPH_PATH = join(getCwd(), '.claude', 'knowledge-graph.json')
let _graph: Graph | null = null

export async function getGraph(): Promise<Graph> {
  if (_graph) return _graph
  const { Graph: G, loadGraph } = await _bellamem()
  if (existsSync(GRAPH_PATH)) {
    try {
      _graph = loadGraph(GRAPH_PATH)
      logForDebugging(`[KG] loaded: ${_graph.concepts.size} concepts, ${_graph.edges.size} edges`)
      return _graph
    } catch (e) {
      logForDebugging(`[KG] load failed: ${e}, creating new`)
    }
  }
  _graph = new G()
  await _save()
  logForDebugging('[KG] created empty')
  return _graph
}

async function _save(): Promise<void> {
  if (!_graph) return
  const { saveGraph } = await _bellamem()
  saveGraph(_graph, GRAPH_PATH)
}

// ─── Helpers ──────────────────────────────────────────

function _findByTopic(g: Graph, topic: string): Concept | null {
  const t = topic.trim()
  for (const c of g.concepts.values()) {
    if (c.topic === t) return c
  }
  return null
}

function _slug(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 100)
}

// ─── CRUD ─────────────────────────────────────────────

export async function upsertNode(input: KGNodeInput): Promise<{ id: string; topic: string; isNew: boolean }> {
  const g = await getGraph()
  const { Concept: C } = await _bellamem()
  const existing = _findByTopic(g, input.topic)
  if (existing) return { id: existing.id, topic: existing.topic, isNew: false }

  const cls = NODE_TYPE_TO_CLASS[input.type] || 'observation'
  const id = `kg:${input.type}:${_slug(input.topic)}`
  const c = new C({
    id, topic: input.topic, class_: cls, nature: 'factual',
    state: cls === 'ephemeral' ? 'open' : null, parent: null,
    mass: 1.0, massFloor: 0.1,
    voices: [input.roleId || 'system'], sourceRefs: [],
    firstVoicedAt: new Date().toISOString(), lastTouchedAt: new Date().toISOString(),
  })
  g.addConcept(c)
  await _save()
  logForDebugging(`[KG] +node ${input.type}/${input.topic}`)
  return { id: c.id, topic: c.topic, isNew: true }
}

export async function addRelation(input: KGRelationInput): Promise<{ id: string; isNew: boolean }> {
  const g = await getGraph()
  const { Edge: E } = await _bellamem()
  const from = _findByTopic(g, input.fromTopic)
  const to = _findByTopic(g, input.toTopic)
  if (!from || !to) throw new Error(`KG edge fail: node missing (${input.fromTopic} / ${input.toTopic})`)
  const etype = RELATION_TO_EDGE[input.type] || 'cause'
  const eid = `${from.id}::${etype}::${to.id}`
  if (g.edges.has(eid)) return { id: eid, isNew: false }
  const e = new E({ type: etype, source: from.id, target: to.id, establishedAt: new Date().toISOString(), confidence: input.confidence || 'medium' })
  g.addEdge(e)
  await _save()
  logForDebugging(`[KG] +edge ${input.fromTopic} -[${input.type}]-> ${input.toTopic}`)
  return { id: e.id, isNew: true }
}

// ─── Query ────────────────────────────────────────────

/** 影響條目 */
export interface ImpactEntry {
  topic: string
  type: string       // concept class 或 node type
  distance: number   // 1 = 直接依賴, 2+ = 間接
  edgeType: string
}

/** 完整影響分析報告 */
export interface ImpactReport {
  changedTopic: string
  modifierRoleId: string
  directDependents: ImpactEntry[]     // 第 1 層：直接依賴這個概念的東西
  cascadeImpacts: ImpactEntry[]       // 第 2+ 層：間接受影響的
  summary: string                     // 一句話摘要
  severity: 'critical' | 'high' | 'medium' | 'low'
}

/**
 * 全域影響分析：當某個概念被修改時，完整的漣漪效應
 *
 * 用法：
 *   const impact = await impactAnalysis('RAG Systems', 'backend-engineer')
 *   → 列出所有直接/間接受影響的專案、機會、角色、技能
 */
export async function impactAnalysis(
  changedTopic: string,
  modifierRoleId: string,
): Promise<ImpactReport> {
  const g = await getGraph()
  const changed = _findByTopic(g, changedTopic)
  if (!changed) {
    return {
      changedTopic,
      modifierRoleId,
      directDependents: [],
      cascadeImpacts: [],
      summary: `⚠️ "${changedTopic}" 不在圖譜中`,
      severity: 'low',
    }
  }

  // BFS: 從 changed 出發，找所有 target = changed.id 的 edge（誰依賴它）
  const direct: ImpactEntry[] = []
  const cascade: ImpactEntry[] = []
  const visited = new Set<string>([changed.id])

  // 第 1 層：直接依賴者
  for (const e of g.edges.values()) {
    if (e.target !== changed.id) continue
    const dep = g.concepts.get(e.source)
    if (!dep || visited.has(dep.id)) continue
    visited.add(dep.id)
    direct.push({
      topic: dep.topic,
      type: dep.class_,
      distance: 1,
      edgeType: e.type,
    })
  }

  // 第 2+ 層：間接依賴（BFS 最多 2 層）
  const queue = direct.map(d => d.topic)
  const queueIds = new Set(direct.map(d => {
    const c = _findByTopic(g, d.topic)
    return c?.id || ''
  }))

  for (const depTopic of queue) {
    const depConcept = _findByTopic(g, depTopic)
    if (!depConcept) continue

    for (const e of g.edges.values()) {
      if (e.target !== depConcept.id) continue
      const indirect = g.concepts.get(e.source)
      if (!indirect || visited.has(indirect.id)) continue
      visited.add(indirect.id)
      cascade.push({
        topic: indirect.topic,
        type: indirect.class_,
        distance: 2,
        edgeType: e.type,
      })
    }
  }

  // 計算嚴重度
  const totalAffected = direct.length + cascade.length
  let severity: ImpactReport['severity'] = 'low'
  if (totalAffected >= 6) severity = 'critical'
  else if (totalAffected >= 4) severity = 'high'
  else if (totalAffected >= 2) severity = 'medium'

  // 生成一句話摘要
  const projectCount = [...direct, ...cascade].filter(e => e.topic.startsWith('Kiro') || e.topic.startsWith('LinguaPlan') || e.topic.startsWith('DocuGuard') || e.topic.startsWith('CLI')).length
  const oppCount = [...direct, ...cascade].filter(e => e.type === 'observation').length
  const roleCount = [...direct, ...cascade].filter(e => e.topic.startsWith('role:')).length

  const parts: string[] = []
  if (direct.length > 0) parts.push(`${direct.length} 個直接依賴`)
  if (cascade.length > 0) parts.push(`${cascade.length} 個間接影響`)
  if (projectCount > 0) parts.push(`${projectCount} 個專案`)
  if (oppCount > 0) parts.push(`${oppCount} 個機會`)
  if (roleCount > 0) parts.push(`${roleCount} 個角色`)

  const summary = parts.length > 0
    ? `🔴 "${changedTopic}" 被 ${modifierRoleId} 修改 → ${parts.join('，')}`
    : `🟢 "${changedTopic}" 沒有已知依賴者`

  return { changedTopic, modifierRoleId, directDependents: direct, cascadeImpacts: cascade, summary, severity }
}

/**
 * 格式化影響分析報告為 Markdown（方便 CEO 閱讀）
 */
export function formatImpactReport(report: ImpactReport): string {
  const lines: string[] = []
  lines.push(`## 🔍 影響分析: "${report.changedTopic}"`)
  lines.push(`> 修改者: ${report.modifierRoleId} | 嚴重度: ${report.severity.toUpperCase()}`)
  lines.push('')
  lines.push(report.summary)
  lines.push('')

  if (report.directDependents.length > 0) {
    lines.push('### 第 1 層：直接依賴')
    for (const d of report.directDependents) {
      lines.push(`- 🎯 **${d.topic}** (${d.type}) — ${d.edgeType}`)
    }
    lines.push('')
  }

  if (report.cascadeImpacts.length > 0) {
    lines.push('### 第 2 層：間接影響')
    for (const c of report.cascadeImpacts) {
      lines.push(`- ⚠️ **${c.topic}** (${c.type}) — ${c.edgeType}`)
    }
    lines.push('')
  }

  if (report.directDependents.length === 0 && report.cascadeImpacts.length === 0) {
    lines.push('✅ 沒有發現受影響的依賴項。')
  }

  return lines.join('\n')
}

/**
 * @deprecated 使用 impactAnalysis() 代替
 */
export async function detectConflicts(changedTopic: string, modifierRoleId: string): Promise<ConflictResult[]> {
  const report = await impactAnalysis(changedTopic, modifierRoleId)
  const affectedRoles = [...report.directDependents, ...report.cascadeImpacts]
    .filter(e => e.topic.startsWith('role:'))
    .map(e => e.topic.replace('role:', ''))
  if (affectedRoles.length === 0) return []
  return [{
    concept: changedTopic,
    modifier: modifierRoleId,
    affectedRoles,
    severity: report.severity === 'critical' ? 'high' : report.severity,
  }]
}

export async function traceCauses(topic: string): Promise<CausalChain> {
  const g = await getGraph()
  const root = _findByTopic(g, topic)
  if (!root) return { topic, chain: [topic, '(node missing)'], blockers: [] }
  const chain = [root.topic]
  const blockers: string[] = []
  const visited = new Set([root.id])
  const q = [root.id]
  while (q.length) {
    const cur = q.shift()!
    for (const e of g.edges.values()) {
      if (e.target !== cur || visited.has(e.source)) continue
      visited.add(e.source)
      const src = g.concepts.get(e.source)
      if (src) {
        chain.push(src.topic)
        if (e.type === 'dispute') blockers.push(src.topic)
        q.push(e.source)
      }
    }
  }
  return { topic, chain, blockers }
}

export async function mapSkillsToOpportunities(): Promise<{ skill: string; opportunities: string[] }[]> {
  const g = await getGraph()
  const skills: Concept[] = []
  const opps = new Map<string, string>()
  for (const c of g.concepts.values()) {
    if (c.id.startsWith('kg:skill:')) skills.push(c)
    if (c.id.startsWith('kg:opportunity:')) opps.set(c.id, c.topic)
  }
  const result: { skill: string; opportunities: string[] }[] = []
  for (const s of skills) {
    const matched: string[] = []
    for (const e of g.edges.values()) {
      const oppId = e.source === s.id ? e.target : e.target === s.id ? e.source : null
      if (oppId && opps.has(oppId)) {
        const t = opps.get(oppId)!
        if (!matched.includes(t)) matched.push(t)
      }
    }
    if (matched.length) result.push({ skill: s.topic, opportunities: matched })
  }
  return result
}

export async function queryGraph(focus: string): Promise<string> {
  const g = await getGraph()
  if (g.concepts.size === 0) return '知識圖譜目前為空。角色完成任務或做出決策後會自動累積。使用 /kg init 初始化角色圖譜。'
  const { askText } = await _bellamem()
  return askText(g, focus, { seedK: 12, minScore: 0.05 })
}

export async function graphHealth(): Promise<string> {
  const g = await getGraph()
  if (g.concepts.size === 0) return '📊 知識圖譜: 空'
  const { audit, formatAudit } = await _bellamem()
  const r = audit(g)
  return formatAudit(r)
}

// ─── Init ─────────────────────────────────────────────

export async function initRoleGraph(): Promise<{ nodes: number; edges: number }> {
  const { ROLE_CATALOG } = await import('../types.js')
  let n = 0; let e = 0
  for (const [rid, meta] of Object.entries(ROLE_CATALOG)) {
    const r = await upsertNode({ type: 'role', topic: `role:${rid}`, description: meta.description, roleId: rid })
    if (r.isNew) n++
  }
  const deps: [string, string, KGRelationType][] = [
    ['role:frontend-engineer', 'role:backend-engineer', 'depends_on'],
    ['role:qa-engineer', 'role:frontend-engineer', 'depends_on'],
    ['role:qa-engineer', 'role:backend-engineer', 'depends_on'],
    ['role:sales-specialist', 'role:product-manager', 'uses'],
    ['role:operations-specialist', 'role:sales-specialist', 'uses'],
    ['role:ceo', 'role:product-manager', 'affects'],
    ['role:ceo', 'role:backend-engineer', 'affects'],
    ['role:ceo', 'role:frontend-engineer', 'affects'],
  ]
  for (const [from, to, relType] of deps) {
    try {
      const r2 = await addRelation({ fromTopic: from, toTopic: to, type: relType, confidence: 'high' })
      if (r2.isNew) e++
    } catch (err) {
      logForDebugging(`[KG] init edge failed: ${from} -> ${to}: ${err}`)
    }
  }
  return { nodes: n, edges: e }
}

// ─── Auto-learner hooks ───────────────────────────────

export async function recordTaskCompletion(roleId: string, title: string, summary: string): Promise<void> {
  try {
    await upsertNode({ type: 'task', topic: title, description: summary, roleId })
    await addRelation({ fromTopic: `role:${roleId}`, toTopic: title, type: 'uses', confidence: 'high' })
  } catch (e) { logForDebugging(`[KG] recordTask failed: ${e}`) }
}

export async function recordDecision(roleId: string, title: string, summary: string, affectedRoles: string[] = []): Promise<void> {
  try {
    await upsertNode({ type: 'decision', topic: title, description: summary, roleId })
    await addRelation({ fromTopic: `role:${roleId}`, toTopic: title, type: 'affects', confidence: 'high' })
    for (const ar of affectedRoles) {
      await upsertNode({ type: 'role', topic: `role:${ar}`, roleId: ar })
      await addRelation({ fromTopic: title, toTopic: `role:${ar}`, type: 'affects', confidence: 'medium' })
    }
  } catch (e) { logForDebugging(`[KG] recordDecision failed: ${e}`) }
}
