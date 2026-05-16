import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import type { AgentTask, RoleState } from './types.js'
import { ROLE_CATALOG } from './types.js'

const TASKS_FILE = '.claude/tasks.json'

function getTasksFilePath(): string {
  return join(getCwd(), TASKS_FILE)
}

function safeParseJSON(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

let mainThreadAgentType = 'ceo'

export function setMainThreadAgentType(roleId: string): void {
  mainThreadAgentType = roleId
}

export function getMainThreadAgentType(): string {
  return mainThreadAgentType
}

export function loadRoleState(): RoleState {
  const defaultState: RoleState = {
    currentRoleId: getMainThreadAgentType() || 'ceo',
    taskList: [],
    lastUpdated: new Date().toISOString(),
  }

  try {
    const tasksPath = getTasksFilePath()
    const content = readFileSync(tasksPath, 'utf-8')
    const parsed = safeParseJSON(content)
    if (parsed && typeof parsed === 'object') {
      return {
        currentRoleId: (parsed as any).currentRoleId || defaultState.currentRoleId,
        taskList: Array.isArray((parsed as any).taskList)
          ? (parsed as any).taskList
          : [],
        lastUpdated: (parsed as any).lastUpdated || defaultState.lastUpdated,
      }
    }
  } catch (e) {
    logForDebugging(`No existing task state found, using defaults`)
  }

  return defaultState
}

export function saveRoleState(state: RoleState): void {
  try {
    const tasksPath = getTasksFilePath()
    const dir = join(tasksPath, '..')
    mkdirSync(dir, { recursive: true })
    writeFileSync(tasksPath, JSON.stringify(state, null, 2) + '\n')
  } catch (e) {
    logForDebugging(`Failed to save task state: ${e}`)
  }
}

export function switchRole(roleId: string): { success: boolean; message: string } {
  if (!ROLE_CATALOG[roleId]) {
    return {
      success: false,
      message: `角色不存在: ${roleId}。可用角色: ${Object.keys(ROLE_CATALOG).join(', ')}`,
    }
  }

  setMainThreadAgentType(roleId)

  const role = ROLE_CATALOG[roleId]
  return {
    success: true,
    message: `✅ 已切换到角色: ${role.roleName} [${role.category === 'decision' ? '决策层' : role.category === 'product' ? '产品层' : '执行层'}]`,
  }
}

export function addTask(
  state: RoleState,
  title: string,
  description: string,
  assignedRole: string,
  priority: 'low' | 'medium' | 'high' = 'medium',
): AgentTask {
  const task: AgentTask = {
    taskId: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description,
    assignedRole,
    status: 'pending',
    priority,
    createdAt: new Date().toISOString(),
  }
  state.taskList.push(task)
  state.lastUpdated = new Date().toISOString()
  saveRoleState(state)
  return task
}

export function updateTaskStatus(
  state: RoleState,
  taskId: string,
  status: AgentTask['status'],
  result?: string,
): boolean {
  const task = state.taskList.find(t => t.taskId === taskId)
  if (!task) return false
  task.status = status
  if (result) task.result = result
  state.lastUpdated = new Date().toISOString()
  saveRoleState(state)
  return true
}

export function formatTaskList(state: RoleState): string {
  if (state.taskList.length === 0) {
    return '📋 当前没有待执行的任务'
  }

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
    failed: '❌',
  }

  const priorityLabel: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
  }

  const lines = ['📋 任务清单:']
  for (const task of state.taskList) {
    const emoji = statusEmoji[task.status] || '❓'
    const role = ROLE_CATALOG[task.assignedRole]?.roleName || task.assignedRole
    lines.push(
      `  ${emoji} [${priorityLabel[task.priority]}] ${task.title} → ${role} (${task.status})`,
    )
    if (task.result) {
      const resultPreview =
        task.result.length > 100
          ? task.result.slice(0, 100) + '...'
          : task.result
      lines.push(`    结果: ${resultPreview}`)
    }
  }

  return lines.join('\n')
}

export function restoreRoleFromSettings(_settingsAgent: string | undefined): void {
  // Standalone: no settings system, just log
  if (_settingsAgent) {
    setMainThreadAgentType(_settingsAgent)
    logForDebugging(`Role set to: ${_settingsAgent}`)
  }
}
