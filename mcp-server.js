// ═══════════════════════════════════════
//  AGNT MCP Server
//  Makes AGNT agents accessible via Model Context Protocol
// ═══════════════════════════════════════

const http = require('http');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const PORT = process.env.MCP_PORT || 3001;

// Fetch agents from backend
async function getAgents() {
  try {
    const r = await fetch(`${BACKEND_URL}/api/agents?limit=50`);
    return await r.json();
  } catch (e) { return []; }
}

// Query an agent via backend
async function queryAgent(agentId, message, walletAddress) {
  try {
    const r = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, message, wallet_address: walletAddress })
    });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // MCP discovery endpoint
  if (req.url === '/.well-known/mcp.json' || req.url === '/mcp') {
    const agents = await getAgents();
    const tools = agents.map(a => ({
      name: `agnt_${a.id}`,
      description: `${a.name}: ${a.description}`,
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Your question or request' },
          wallet_address: { type: 'string', description: 'TON wallet address (optional)' }
        },
        required: ['message']
      }
    }));

    // Add meta-tools
    tools.push({
      name: 'agnt_list_agents',
      description: 'List all available AGNT agents with their capabilities',
      parameters: { type: 'object', properties: {} }
    });
    tools.push({
      name: 'agnt_market_data',
      description: 'Get live TON/BTC/ETH prices from CoinGecko',
      parameters: { type: 'object', properties: {} }
    });

    res.writeHead(200);
    res.end(JSON.stringify({ tools }));
    return;
  }

  // Tool execution
  if (req.method === 'POST' && req.url === '/execute') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { tool, parameters } = JSON.parse(body);

        if (tool === 'agnt_list_agents') {
          const agents = await getAgents();
          res.writeHead(200);
          res.end(JSON.stringify({ result: agents.map(a => `${a.icon} ${a.name} — ${a.description} (${a.total_queries} queries)`).join('\n') }));
          return;
        }

        if (tool === 'agnt_market_data') {
          const r = await fetch(`${BACKEND_URL}/api/market`);
          const data = await r.json();
          res.writeHead(200);
          res.end(JSON.stringify({ result: data }));
          return;
        }

        // Agent tool
        const agentId = tool.replace('agnt_', '');
        const result = await queryAgent(agentId, parameters.message, parameters.wallet_address);
        res.writeHead(200);
        res.end(JSON.stringify({ result: result.text || result.error || 'No response' }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`AGNT MCP server on port ${PORT}`);
  console.log(`Backend: ${BACKEND_URL}`);
});
