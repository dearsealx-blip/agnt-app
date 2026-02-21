#!/bin/bash
# ═══════════════════════════════════════
#  AGNT — One-Command Deploy Script
# ═══════════════════════════════════════
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🤖 AGNT Deploy Script${NC}"
echo "========================="
echo ""

# Check node
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js required. Install from https://nodejs.org${NC}"
    exit 1
fi
NODE_V=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_V" -lt 20 ]; then
    echo -e "${RED}❌ Node.js 20+ required (you have $(node -v))${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Install deps
echo ""
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install --production 2>/dev/null
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Check .env
if [ ! -f .env ]; then
    echo ""
    echo -e "${YELLOW}No .env file found. Let's set it up:${NC}"
    echo ""
    
    read -p "Claude API Key (sk-ant-...): " CLAUDE_KEY
    read -p "Telegram Bot Token (from @BotFather): " BOT_TOKEN
    read -p "Your TON wallet address: " WALLET
    read -p "Webapp URL (GitHub Pages URL): " WEBAPP_URL
    
    cat > .env << ENVEOF
PORT=3000
CLAUDE_API_KEY=$CLAUDE_KEY
CLAUDE_MODEL=claude-haiku-4-5-20251001
BOT_TOKEN=$BOT_TOKEN
OWNER_WALLET=$WALLET
WEBAPP_URL=$WEBAPP_URL
DB_PATH=./agnt.db
ENVEOF
    echo -e "${GREEN}✓ .env created${NC}"
else
    echo -e "${GREEN}✓ .env found${NC}"
fi

# Load env
export $(grep -v '^#' .env | xargs)

echo ""
echo "========================="
echo -e "${GREEN}Starting AGNT...${NC}"
echo ""
echo "  Backend:  http://localhost:${PORT:-3000}"
echo "  Admin:    http://localhost:${PORT:-3000}/admin.html"
echo "  MCP:      http://localhost:3001"
echo ""
echo -e "${YELLOW}Starting backend + bot + mcp...${NC}"

# Start all services
node server.js &
BACKEND_PID=$!
sleep 1

if [ ! -z "$BOT_TOKEN" ]; then
    BACKEND_URL="http://localhost:${PORT:-3000}" node bot.js &
    BOT_PID=$!
    echo -e "${GREEN}✓ Bot started${NC}"
fi

BACKEND_URL="http://localhost:${PORT:-3000}" node mcp-server.js &
MCP_PID=$!
echo -e "${GREEN}✓ MCP server started${NC}"

echo ""
echo -e "${GREEN}🤖 AGNT is running!${NC}"
echo ""
echo "Press Ctrl+C to stop"

# Cleanup on exit
trap "kill $BACKEND_PID $BOT_PID $MCP_PID 2>/dev/null; echo ''; echo 'Stopped.'" EXIT
wait
