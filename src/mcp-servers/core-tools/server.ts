/**
 * MCP Core Tools Server — Lightweight File & Web Tools
 *
 * Exposes 7 tools via stdio MCP: read_file, list_dir, search_content,
 * write_file, web_fetch, web_search.
 * Tools are imported from the shared registry (single source of truth).
 *
 * Usage: bun run src/mcp-servers/core-tools/server.ts
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { listTools, executeToolCall } from '../../tools/registry.js'

// ─── Build MCP tool definitions from registry ──────────

const MCP_TOOLS = listTools().map((t) => ({
  name: `core_${t.name}`,
  description: t.description,
  inputSchema: {
    type: 'object' as const,
    properties: Object.fromEntries(
      Object.entries(t.parameters).map(([key, p]) => [
        key,
        {
          type: p.type,
          description: p.description,
          ...(p.default !== undefined ? { default: p.default } : {}),
        },
      ])
    ),
    required: Object.entries(t.parameters)
      .filter(([_, p]) => p.required)
      .map(([key]) => key),
  },
}))

// ─── Server setup ─────────────────────────────────────

const server = new Server(
  {
    name: 'mcp-core-tools-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: MCP_TOOLS }
})

// Call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // Strip core_ prefix to get registry tool name
  const toolName = name.startsWith('core_') ? name.slice(5) : name

  try {
    const params: Record<string, string> = {}
    if (args) {
      for (const [k, v] of Object.entries(args)) {
        params[k] = String(v ?? '')
      }
    }

    const result = await executeToolCall(toolName, params)

    if (result.success) {
      return {
        content: [{ type: 'text', text: result.data }],
      }
    }

    return {
      content: [{ type: 'text', text: result.error || 'Unknown error' }],
      isError: true,
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Tool error (${toolName}): ${error.message || String(error)}`,
        },
      ],
      isError: true,
    }
  }
})

// ─── Start ────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[MCP Core Tools Server] Started, 7 tools available\n')
}

main().catch((err) => {
  process.stderr.write(`[MCP Core Tools Server] Start failed: ${err.message}\n`)
  process.exit(1)
})
