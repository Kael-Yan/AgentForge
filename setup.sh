#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# AgentForge — 一键部署脚本
# CEO + 7 核心角色 · 多智能体协作系统
# ═══════════════════════════════════════════════════════════
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

PASS="${GREEN}✓${NC}"
FAIL="${RED}✗${NC}"
WARN="${YELLOW}⚠${NC}"

echo ""
echo -e "${CYAN}${BOLD}🤖 AgentForge — 多智能体协作系统${NC}"
echo -e "${CYAN}   一键部署脚本${NC}"
echo ""

# ═══════════════════════════════════════════════════════════
# Step 1: 检查操作系统
# ═══════════════════════════════════════════════════════════
echo -e "${BOLD}[1/4]${NC} 检查操作系统..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo -e "  $PASS macOS $(sw_vers -productVersion 2>/dev/null || echo 'detected')"
else
  echo -e "  $WARN 当前系统: $OSTYPE"
  echo "  AgentForge 主要测试于 macOS，部分功能(MCP Desktop)仅限 macOS。"
  echo "  核心多智能体系统可在 Linux 上运行。"
fi

# ═══════════════════════════════════════════════════════════
# Step 2: 检查 Bun
# ═══════════════════════════════════════════════════════════
echo -e "${BOLD}[2/4]${NC} 检查 Bun..."
if command -v bun &> /dev/null; then
  BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
  echo -e "  $PASS Bun $BUN_VERSION"
else
  echo -e "  $WARN 未安装 Bun"
  echo "  正在安装 Bun..."
  if command -v curl &> /dev/null; then
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    echo -e "  $PASS Bun 已安装"
  else
    echo -e "  $FAIL 需要 curl 来安装 Bun。请手动安装: https://bun.sh"
    exit 1
  fi
fi

# ═══════════════════════════════════════════════════════════
# Step 3: 安装依赖
# ═══════════════════════════════════════════════════════════
echo -e "${BOLD}[3/4]${NC} 安装项目依赖..."
if [ -f "package.json" ]; then
  bun install
  echo -e "  $PASS 依赖安装完成"
else
  echo -e "  $FAIL 找不到 package.json"
  exit 1
fi

# ═══════════════════════════════════════════════════════════
# Step 4: 验证
# ═══════════════════════════════════════════════════════════
echo -e "${BOLD}[4/4]${NC} 最终验证..."

FAIL_COUNT=0

# 验证 Bun 可执行
if bun --version &> /dev/null; then
  echo -e "  $PASS Bun 可执行"
else
  echo -e "  $FAIL Bun 无法执行"
  ((FAIL_COUNT++))
fi

# 验证 TypeScript 可编译
if bun run src/index.ts help &> /dev/null; then
  echo -e "  $PASS CLI 入口正常"
else
  echo -e "  $FAIL CLI 入口启动失败"
  ((FAIL_COUNT++))
fi

# 验证 Desktop MCP 可启动
bun run src/mcp-servers/desktop/server.ts &
DPID=$!
sleep 2
if kill $DPID 2>/dev/null; then
  echo -e "  $PASS Desktop MCP 可启动"
else
  echo -e "  $WARN Desktop MCP 启动测试未确定"
fi

echo ""
if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║  🎉 部署完成！所有检查通过              ║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BOLD}快速开始:${NC}"
  echo ""
  echo "  # 查看状态和帮助"
  echo "  bun run dev"
  echo ""
  echo "  # 列出所有智能体角色"
  echo "  bun run dev -- roles"
  echo ""
  echo "  # 切换角色"
  echo "  bun run dev -- role ceo"
  echo ""
  echo "  # 启动 Desktop MCP (macOS 桌面控制)"
  echo "  bun run desktop-server"
  echo ""
  echo -e "${YELLOW}注意: 本系统设计为 Claude Code 插件/Skill。${NC}"
  echo -e "${YELLOW}在 Claude Code 中配置 .claude/mcp.json 即可使用 MCP 服务。${NC}"
  echo ""
else
  echo -e "${RED}${BOLD}╔══════════════════════════════════════════╗${NC}"
  echo -e "${RED}${BOLD}║  ⚠️  有 $FAIL_COUNT 项检查未通过               ║${NC}"
  echo -e "${RED}${BOLD}╚══════════════════════════════════════════╝${NC}"
  echo ""
  echo "请根据上方的 ${RED}✗${NC} 提示修复后重试。"
  exit 1
fi
