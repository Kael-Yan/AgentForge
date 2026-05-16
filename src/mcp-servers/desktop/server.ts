/**
 * MCP Desktop Server — macOS 桌面操控
 *
 * 用 stdio 傳輸的 MCP Server，為 CLI 智能體提供 6 個桌面控制工具。
 * 底層使用 macOS 內建的 osascript / screencapture / open 指令。
 *
 * 運行: bun run .claude/mcp-servers/desktop/server.ts
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { execFileSync, spawn } from 'child_process'

// ─── Tool definitions ─────────────────────────────────

const TOOLS = [
  {
    name: 'desktop_screenshot',
    description:
      '截取當前螢幕畫面，保存為 PNG 檔案。回傳檔案路徑。相當於給智能體一雙「眼睛」來看你的桌面。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filepath: {
          type: 'string',
          description: '儲存路徑，預設 /tmp/cc_screenshot.png',
          default: '/tmp/cc_screenshot.png',
        },
        capture_region: {
          type: 'string',
          description: '可選：只截取特定區域。格式 "x,y,width,height" 或省略以全螢幕截取',
        },
      },
    },
  },
  {
    name: 'desktop_click',
    description:
      '移動滑鼠到指定座標並點擊。座標原點 (0,0) 在螢幕左上角。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number', description: 'X 座標 (像素)' },
        y: { type: 'number', description: 'Y 座標 (像素)' },
        button: {
          type: 'string',
          description: '滑鼠按鈕: left (預設), right, double',
          default: 'left',
        },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop_type',
    description:
      '模擬鍵盤輸入文字。文字會逐字輸入，就像人在打字一樣。不支援中文輸入法——請用 desktop_clipboard 貼上中文。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: '要輸入的文字 (ASCII/英文為佳)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'desktop_key',
    description:
      '按下特定鍵盤按鍵。支援特殊鍵如 return、tab、space、escape、上下左右等。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: {
          type: 'string',
          description:
            '按鍵名稱，如: return, tab, space, escape, delete, left, right, up, down, f1-f12',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: '修飾鍵組合，如: ["command", "shift"]',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'desktop_open_app',
    description:
      '開啟指定的應用程式。如果應用已執行則切換到該應用。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_name: {
          type: 'string',
          description: '應用程式名稱，如 "Google Chrome", "Safari", "Terminal", "Finder"',
        },
        wait: {
          type: 'boolean',
          description: '是否等待應用完全啟動 (預設 true)',
          default: true,
        },
      },
      required: ['app_name'],
    },
  },
  {
    name: 'desktop_applescript',
    description:
      '執行任意 AppleScript 指令。這是萬能工具——當其他工具無法完成任務時使用。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        script: { type: 'string', description: 'AppleScript 指令碼' },
      },
      required: ['script'],
    },
  },
  {
    name: 'desktop_clipboard',
    description:
      '讀取或寫入系統剪貼簿。支援中文和任何 Unicode 文字。寫入後建議用 desktop_key("command", ["command"]) + desktop_key("v", ["command"]) 來貼上。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          description: '"copy" 從剪貼簿讀取, "paste" 將文字寫入剪貼簿',
          enum: ['copy', 'paste'],
        },
        text: {
          type: 'string',
          description: '要寫入剪貼簿的文字 (僅 action=paste 時需要)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'desktop_get_window_list',
    description:
      '獲取當前所有視窗的標題列表。用於了解桌面狀態、找到要操控的目標視窗。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        app_name: {
          type: 'string',
          description: '可選：只列出特定應用的視窗。省略則列出所有視窗。',
        },
      },
    },
  },
]

// ─── Tool implementations ─────────────────────────────

function runOsascript(script: string): string {
  const result = execFileSync('osascript', ['-e', script], {
    encoding: 'utf-8',
    timeout: 15000,
  })
  return result.trim()
}

function runOsascriptSafe(script: string): { success: boolean; output: string } {
  try {
    return { success: true, output: runOsascript(script) }
  } catch (e: any) {
    return { success: false, output: e.stderr || e.message || String(e) }
  }
}

// Key code mapping for common macOS keys
const KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  escape: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  'page up': 116,
  'page down': 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
  f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
}

async function handleScreenshot(args: Record<string, any>): Promise<string> {
  const filepath = args.filepath || '/tmp/cc_screenshot.png'

  if (args.capture_region) {
    // Region capture with screencapture -R x,y,w,h
    execFileSync('screencapture', ['-x', '-R', args.capture_region, filepath], {
      timeout: 10000,
    })
  } else {
    // Full screen capture (silent mode, no UI sound)
    execFileSync('screencapture', ['-x', filepath], {
      timeout: 10000,
    })
  }

  return `✅ 螢幕截圖已保存: ${filepath}`
}

async function handleClick(args: Record<string, any>): Promise<string> {
  const x = args.x
  const y = args.y
  const button = args.button || 'left'

  if (button === 'right') {
    // Right-click via AppleScript
    const script = `
      tell application "System Events"
        set pos to {${x}, ${y}}
        click at pos with option down
      end tell
    `
    runOsascript(`tell application "System Events" to click at {${x}, ${y}} button 2`)
    return `✅ 右鍵點擊: (${x}, ${y})`
  }

  if (button === 'double') {
    runOsascript(`tell application "System Events" to double click at {${x}, ${y}}`)
    return `✅ 雙擊: (${x}, ${y})`
  }

  // Default: left click
  runOsascript(`tell application "System Events" to click at {${x}, ${y}}`)
  return `✅ 左鍵點擊: (${x}, ${y})`
}

async function handleType(args: Record<string, any>): Promise<string> {
  const text = args.text as string

  // For plain ASCII, use keystroke directly
  // For text with special chars, escape properly
  const escapedText = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

  runOsascript(`tell application "System Events" to keystroke "${escapedText}"`)
  return `✅ 已輸入文字 (${text.length} 字元)`
}

async function handleKey(args: Record<string, any>): Promise<string> {
  const key = (args.key as string).toLowerCase()
  const modifiers = (args.modifiers as string[]) || []

  // Use key code if available, otherwise use keystroke
  const keyCode = KEY_CODES[key]
  const keySpec = keyCode !== undefined ? `key code ${keyCode}` : `keystroke "${key}"`

  if (modifiers.length > 0) {
    const modString = modifiers.map(m => `${m} down`).join(', ')
    runOsascript(`
      tell application "System Events"
        ${modString}
        ${keySpec}
        ${modifiers.map(m => `${m} up`).join('\n        ')}
      end tell
    `)
  } else {
    runOsascript(`tell application "System Events" to ${keySpec}`)
  }

  const modDesc = modifiers.length > 0 ? ` (修飾鍵: ${modifiers.join('+')})` : ''
  return `✅ 已按下: ${key}${modDesc}`
}

async function handleOpenApp(args: Record<string, any>): Promise<string> {
  const appName = args.app_name
  const wait = args.wait !== false

  const script = wait
    ? `tell application "${appName}" to activate`
    : `do shell script "open -a '${appName}'"`

  const result = runOsascriptSafe(script)
  if (!result.success) {
    // Try alternative: open -a
    try {
      execFileSync('open', ['-a', appName], { timeout: 10000 })
      return `✅ 已開啟: ${appName}`
    } catch {
      return `❌ 無法開啟應用: ${appName}。請確認應用名稱正確。\n${result.output}`
    }
  }
  return `✅ 已開啟/切換到: ${appName}`
}

async function handleApplescript(args: Record<string, any>): Promise<string> {
  const script = args.script
  const result = runOsascriptSafe(script)
  if (!result.success) {
    return `❌ AppleScript 執行失敗:\n${result.output}`
  }
  return result.output || '✅ AppleScript 已執行 (無回傳值)'
}

async function handleClipboard(args: Record<string, any>): Promise<string> {
  const action = args.action

  if (action === 'copy') {
    const result = execFileSync('pbpaste', [], {
      encoding: 'utf-8',
      timeout: 5000,
    })
    return result || '(剪貼簿為空)'
  }

  if (action === 'paste') {
    const text = args.text || ''
    // Use pbcopy for writing to clipboard
    const child = spawn('pbcopy', [], {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.stdin.write(text)
    child.stdin.end()
    await new Promise<void>((resolve, reject) => {
      child.on('close', (code: number) => {
        code === 0 ? resolve() : reject(new Error(`pbcopy exited with code ${code}`))
      })
    })
    return `✅ 已寫入剪貼簿 (${text.length} 字元)。使用 Cmd+V 貼上。`
  }

  return '❌ 未知操作。請使用 "copy" 或 "paste"'
}

async function handleGetWindowList(args: Record<string, any>): Promise<string> {
  const appName = args.app_name

  if (appName) {
    const script = `
      tell application "System Events"
        set winList to name of every window of process "${appName}"
        return winList as text
      end tell
    `
    const result = runOsascriptSafe(script)
    if (!result.success) {
      return `❌ 無法獲取「${appName}」的視窗列表。應用可能未執行。`
    }
    const windows = result.output.split(', ').filter(Boolean)
    if (windows.length === 0) return `「${appName}」目前沒有開啟的視窗。`
    return `「${appName}」的視窗:\n${windows.map((w, i) => `  ${i + 1}. ${w}`).join('\n')}`
  }

  // All windows from all running apps
  const script = `
    tell application "System Events"
      set output to ""
      set allProcesses to every process whose background only is false
      repeat with p in allProcesses
        set pName to name of p
        try
          set winCount to count of windows of p
          if winCount > 0 then
            set output to output & pName & " (" & winCount & " 個視窗)" & return
          end if
        end try
      end repeat
      return output
    end tell
  `
  const result = runOsascriptSafe(script)
  if (!result.success) {
    return `❌ 無法獲取視窗列表。\n${result.output}`
  }
  const lines = result.output.split('\n').filter(Boolean)
  if (lines.length === 0) return '目前沒有開啟的視窗。'
  return `當前桌面視窗:\n${lines.map(l => `  • ${l.trim()}`).join('\n')}`
}

// ─── Server setup ─────────────────────────────────────

const server = new Server(
  {
    name: 'mcp-desktop-server',
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
  return { tools: TOOLS }
})

// Call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'desktop_screenshot':
        return {
          content: [{ type: 'text', text: await handleScreenshot(args || {}) }],
        }

      case 'desktop_click':
        return {
          content: [{ type: 'text', text: await handleClick(args || {}) }],
        }

      case 'desktop_type':
        return {
          content: [{ type: 'text', text: await handleType(args || {}) }],
        }

      case 'desktop_key':
        return {
          content: [{ type: 'text', text: await handleKey(args || {}) }],
        }

      case 'desktop_open_app':
        return {
          content: [{ type: 'text', text: await handleOpenApp(args || {}) }],
        }

      case 'desktop_applescript':
        return {
          content: [{ type: 'text', text: await handleApplescript(args || {}) }],
        }

      case 'desktop_clipboard':
        return {
          content: [{ type: 'text', text: await handleClipboard(args || {}) }],
        }

      case 'desktop_get_window_list':
        return {
          content: [{ type: 'text', text: await handleGetWindowList(args || {}) }],
        }

      default:
        return {
          content: [{ type: 'text', text: `❌ 未知工具: ${name}` }],
          isError: true,
        }
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ 工具執行錯誤 (${name}): ${error.message || String(error)}`,
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
  // Log to stderr so it doesn't interfere with stdio protocol
  process.stderr.write('[MCP Desktop Server] 已啟動，等待工具調用...\n')
}

main().catch((err) => {
  process.stderr.write(`[MCP Desktop Server] 啟動失敗: ${err.message}\n`)
  process.exit(1)
})
