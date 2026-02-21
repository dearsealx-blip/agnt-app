# AGNT — Real AI Agents on TON

38KB Telegram Mini App. Real AI with live market data, wallet access, on-chain intelligence.

## Quick Start

```bash
git clone https://github.com/dearsealx-blip/agnt-app.git
cd agnt-app
# Push public/ to GitHub Pages, set up BotFather, done.
```

## Full Stack (optional)

```bash
npm install
cp .env.example .env   # Edit with your keys
node seed.js            # Seed templates
node server.js          # Backend :3000
node bot.js             # Telegram bot
node mcp-server.js      # MCP :3001
```

## What's Real

- Prices → CoinGecko API (live)
- Wallet → TonAPI (your actual balance)
- Chain → TonAPI (real blocks)
- AI → Claude (real reasoning)
- Payments → TonConnect

## License
MIT
