#!/usr/bin/env bun
/**
 * AgentForge v2.0.0
 * Multi-Agent Collaboration System — CEO + 7 Core Roles
 *
 * Usage:
 *   bun run dev                          # Show status and help
 *   bun run dev -- role <roleId>         # Switch to a specific role
 *   bun run dev -- task <title>          # Add a task
 *   bun run dev -- list                  # List all tasks
 *   bun run dev -- tool <name> '<json>'  # Run a core tool
 *   bun run dev -- tools                  # List available tools
 *   bun run dev -- desktop-server        # Start Desktop MCP server
 */

import { ROLE_CATALOG } from './multi-role/types.js'
import {
  loadRoleState,
  switchRole,
  addTask,
  formatTaskList,
} from './multi-role/role-state.js'
import { listTools, executeToolCall, getTool } from './tools/registry.js'

const args = process.argv.slice(2)
const command = args[0]

function showBanner(): void {
  console.log('')
  console.log('🤖 AgentForge v2.0.0')
  console.log('   CEO Quality Gate + 7 Core Roles · Paperclip Heartbeat')
  console.log('')
}

function showHelp(): void {
  showBanner()
  console.log('Usage:')
  console.log('  bun run dev                    Show status')
  console.log('  bun run dev -- role <roleId>   Switch role')
  console.log('  bun run dev -- roles           List all roles')
  console.log('  bun run dev -- task <title>    Add a task to current role')
  console.log('  bun run dev -- list            List all tasks')
  console.log('  bun run dev -- tool <name> \'{"key":"val"}\'  Run a tool')
  console.log('  bun run dev -- tools                 List all tools')
  console.log('  bun run dev -- desktop-server        Start Desktop MCP server')
  console.log('')
  console.log('Quick Start:')
  console.log('  bun run desktop-server         Desktop MCP (macOS control)')
  console.log('  bun run core-tools-server      Core Tools MCP (7 tools)')
  console.log('')
}

function listRoles(): void {
  console.log('\n📋 Available Roles:\n')
  for (const [id, meta] of Object.entries(ROLE_CATALOG)) {
    const catLabel =
      meta.category === 'decision'
        ? '决策层'
        : meta.category === 'product'
          ? '产品层'
          : '执行层'
    console.log(`  ${meta.roleName.padEnd(14)} (${id}) [${catLabel}]`)
    console.log(`    ${meta.description}`)
    console.log('')
  }
}

function showStatus(): void {
  const state = loadRoleState()
  const currentRole = ROLE_CATALOG[state.currentRoleId]

  showBanner()
  console.log(`🎯 Current Role: ${currentRole?.roleName || state.currentRoleId}`)
  console.log(`   ${currentRole?.description || ''}`)
  console.log('')
  console.log(formatTaskList(state))
  console.log('')
  console.log('📦 Servers:')
  console.log('   Desktop MCP   → bun run desktop-server')
  console.log('   Core Tools    → bun run core-tools-server')
  console.log('')
}

// Main
if (!command || command === 'help' || command === '--help' || command === '-h') {
  showHelp()
} else if (command === 'roles') {
  listRoles()
} else if (command === 'role') {
  const roleId = args[1]
  if (!roleId) {
    console.log('Usage: bun run dev -- role <roleId>')
    console.log('Use "bun run dev -- roles" to see available roles')
    process.exit(1)
  }
  const result = switchRole(roleId)
  console.log(result.message)
} else if (command === 'task') {
  const title = args.slice(1).join(' ')
  if (!title) {
    console.log('Usage: bun run dev -- task <title>')
    process.exit(1)
  }
  const state = loadRoleState()
  const task = addTask(state, title, '', state.currentRoleId)
  console.log(`✅ Task created: ${task.title} → assigned to ${ROLE_CATALOG[state.currentRoleId]?.roleName}`)
} else if (command === 'list') {
  const state = loadRoleState()
  showBanner()
  console.log(formatTaskList(state))
} else if (command === 'desktop-server') {
  console.log('Starting Desktop MCP server...')
  console.log('(Use bun run desktop-server for direct startup)')
} else if (command === 'core-tools-server') {
  console.log('Starting Core Tools MCP server...')
  console.log('(Use bun run core-tools-server for direct startup)')
} else if (command === 'tools') {
  console.log('\n🔧 Available Tools:\n')
  for (const tool of listTools()) {
    const params = Object.entries(tool.parameters)
      .map(([k, p]) => `${k}${p.required ? '*' : '?'}: ${p.type}`)
      .join(', ')
    console.log(`  ${tool.name}`)
    console.log(`    ${tool.description}`)
    console.log(`    Params: ${params || 'none'}`)
    console.log('')
  }
} else if (command === 'tool') {
  const toolName = args[1]
  if (!toolName) {
    console.log('Usage: bun run dev -- tool <name> \'{"key":"val"}\'')
    console.log('Use "bun run dev -- tools" to see available tools')
    process.exit(1)
  }
  const tool = getTool(toolName)
  if (!tool) {
    console.log(`Unknown tool: ${toolName}`)
    console.log('Use "bun run dev -- tools" to see available tools')
    process.exit(1)
  }

  let params: Record<string, string> = {}
  const paramsStr = args[2]
  if (paramsStr) {
    try {
      params = JSON.parse(paramsStr)
    } catch {
      console.log(`Invalid JSON params: ${paramsStr}`)
      process.exit(1)
    }
  }

  console.log(`Running ${toolName}...`)
  const result = await executeToolCall(toolName, params)
  if (result.success) {
    console.log(result.data)
  } else {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }
} else {
  showStatus()
}
