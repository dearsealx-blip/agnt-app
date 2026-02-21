// ═══════════════════════════════════════
//  AGNT Backend — Real Agent Platform
//  Express + SQLite + Claude AI
// ═══════════════════════════════════════

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// ═══ CONFIG ═══
const PORT = process.env.PORT || 3000;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OWNER_WALLET = process.env.OWNER_WALLET || 'UQAbpN74Kp_u9YFygTTKsl0MFO4atpyCKC0C7awTRRxspE6G';
const CREATOR_SHARE = 0.7;  // 70% to agent creator
const PROTOCOL_SHARE = 0.3; // 30% to protocol

// ═══ DATABASE ═══
const db = new Database(process.env.DB_PATH || './agnt.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE,
    wallet_address TEXT,
    username TEXT,
    first_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '🤖',
    description TEXT,
    system_prompt TEXT NOT NULL,
    knowledge TEXT,
    color TEXT DEFAULT '#00e8b8',
    tools_prices BOOLEAN DEFAULT 1,
    tools_wallet BOOLEAN DEFAULT 0,
    tools_tonapi BOOLEAN DEFAULT 0,
    price_per_query REAL DEFAULT 0.01,
    creator_id INTEGER REFERENCES users(id),
    creator_wallet TEXT,
    is_core BOOLEAN DEFAULT 0,
    is_public BOOLEAN DEFAULT 1,
    tags TEXT,
    total_queries INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0,
    rating_sum REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT REFERENCES agents(id),
    user_id INTEGER REFERENCES users(id),
    user_message TEXT,
    agent_response TEXT,
    tools_used TEXT,
    context_data TEXT,
    cost REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT REFERENCES agents(id),
    content TEXT NOT NULL,
    tools_used TEXT,
    source_query_id INTEGER REFERENCES queries(id),
    likes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT REFERENCES agents(id),
    user_id INTEGER REFERENCES users(id),
    score INTEGER CHECK(score BETWEEN 1 AND 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT REFERENCES agents(id),
    user_id INTEGER REFERENCES users(id),
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS follows (
    user_id INTEGER REFERENCES users(id),
    agent_id TEXT REFERENCES agents(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, agent_id)
  );

  CREATE INDEX IF NOT EXISTS idx_queries_agent ON queries(agent_id);
  CREATE INDEX IF NOT EXISTS idx_queries_user ON queries(user_id);
  CREATE INDEX IF NOT EXISTS idx_feed_agent ON feed(agent_id);
  CREATE INDEX IF NOT EXISTS idx_feed_time ON feed(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_agents_public ON agents(is_public, total_queries DESC);
`);

// Insert AGNT core agent if not exists
const coreExists = db.prepare('SELECT id FROM agents WHERE id = ?').get('agnt_core');
if (!coreExists) {
  db.prepare(`INSERT INTO agents (id, name, icon, description, system_prompt, tools_prices, tools_wallet, tools_tonapi, price_per_query, is_core, is_public, tags)
    VALUES (?, ?, ?, ?, ?, 1, 1, 1, 0, 1, 1, ?)`).run(
    'agnt_core', 'AGNT', '🤖',
    'Your AI on TON. Real market data, wallet access, on-chain intelligence. Build your own agents.',
    `You are AGNT, the core AI of the AGNT platform on TON blockchain.

You have real tools — live price data, wallet balances, and on-chain data are injected into your context. Use this real data in every response. Never make up numbers.

Your roles:
1. ANALYST — Real market analysis using live data in your context. Give specific numbers.
2. ASSISTANT — Help with TON, DeFi, staking, NFTs, bridging. Be practical.
3. BUILDER — When a user wants to create an agent, guide them conversationally. When ready, output:
\`\`\`agentconfig
{"name":"...","icon":"emoji","desc":"...","prompt":"...","tools":{"prices":true,"wallet":false,"tonapi":false},"knowledge":"...","price":0.01,"tags":["..."]}
\`\`\`

Be direct. Use real numbers. No filler. Just be helpful.`,
    'platform,builder,analysis'
  );
}

// ═══ AUTH MIDDLEWARE ═══
function authenticateTelegram(req, res, next) {
  // Extract Telegram initData from header
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) {
    // Allow unauthenticated for now, just mark as anonymous
    req.user = null;
    return next();
  }

  try {
    // Validate Telegram initData
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const sorted = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join('\n');

    if (BOT_TOKEN) {
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
      const checkHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      if (checkHash !== hash) {
        req.user = null;
        return next();
      }
    }

    const userData = JSON.parse(params.get('user') || '{}');
    if (userData.id) {
      // Upsert user
      db.prepare(`INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP, username = excluded.username`)
        .run(String(userData.id), userData.username || '', userData.first_name || 'User');

      req.user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(userData.id));
    }
  } catch (e) {
    req.user = null;
  }
  next();
}

app.use(authenticateTelegram);

// ═══ MARKET DATA CACHE ═══
let marketCache = { data: null, ts: 0 };

async function getMarketData() {
  if (marketCache.data && Date.now() - marketCache.ts < 30000) return marketCache.data;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true');
    const d = await r.json();
    const ton = d['the-open-network'] || {};
    marketCache.data = {
      ton: { price: ton.usd || 0, change: ton.usd_24h_change || 0, mcap: ton.usd_market_cap || 0, vol: ton.usd_24h_vol || 0 },
      btc: { price: d.bitcoin?.usd || 0 },
      eth: { price: d.ethereum?.usd || 0 }
    };
    marketCache.ts = Date.now();
  } catch (e) {
    if (!marketCache.data) marketCache.data = { ton: { price: 0 }, btc: { price: 0 }, eth: { price: 0 } };
  }
  return marketCache.data;
}

async function getWalletData(address) {
  if (!address) return null;
  try {
    const [balR, jetR] = await Promise.all([
      fetch(`https://tonapi.io/v2/accounts/${address}`).then(r => r.json()),
      fetch(`https://tonapi.io/v2/accounts/${address}/jettons`).then(r => r.json()).catch(() => ({ balances: [] }))
    ]);
    const bal = balR.balance ? parseInt(balR.balance) / 1e9 : 0;
    const tokens = (jetR.balances || []).slice(0, 8).map(b => {
      const sym = b.jetton?.symbol || '?';
      const dec = b.jetton?.decimals || 9;
      const amt = parseInt(b.balance) / Math.pow(10, dec);
      return { symbol: sym, balance: amt.toFixed(2) };
    }).filter(t => t.symbol !== '?');
    return { balance: bal, tokens };
  } catch (e) { return null; }
}

async function getChainData() {
  try {
    const r = await fetch('https://tonapi.io/v2/blockchain/masterchain-head');
    const d = await r.json();
    return { block: d.seqno || '?', status: 'operational' };
  } catch (e) { return { block: '?', status: 'unknown' }; }
}

// Build tool context string for an agent
async function buildContext(agent, walletAddress) {
  const ctx = [];

  if (agent.tools_prices) {
    const m = await getMarketData();
    const tc = m.ton.change || 0;
    ctx.push(`[LIVE MARKET DATA] TON: $${m.ton.price?.toFixed(3)} (${tc >= 0 ? '+' : ''}${tc.toFixed(1)}% 24h) | MCap: $${(m.ton.mcap / 1e9).toFixed(2)}B | Vol: $${(m.ton.vol / 1e6).toFixed(1)}M | BTC: $${m.btc.price?.toFixed(0)} | ETH: $${m.eth.price?.toFixed(0)}`);
  }

  if (agent.tools_wallet && walletAddress) {
    const w = await getWalletData(walletAddress);
    if (w) {
      let wCtx = `[USER WALLET] ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)} | ${w.balance.toFixed(2)} TON ($${(w.balance * (marketCache.data?.ton?.price || 0)).toFixed(2)})`;
      if (w.tokens.length) wCtx += ` | Tokens: ${w.tokens.map(t => `${t.symbol}: ${t.balance}`).join(', ')}`;
      ctx.push(wCtx);
    }
  }

  if (agent.tools_tonapi) {
    const c = await getChainData();
    ctx.push(`[ON-CHAIN] Block #${c.block} | Network: ${c.status}`);
  }

  ctx.push(`[TIME] ${new Date().toISOString()}`);
  return ctx.join('\n');
}

// ═══ CLAUDE AI ═══
async function queryAI(systemPrompt, userMessage, context, maxTokens = 600) {
  if (!CLAUDE_KEY) return { error: 'AI not configured. Set CLAUDE_API_KEY.' };

  const fullSystem = systemPrompt + '\n\n' + context;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: fullSystem,
        messages: [{ role: 'user', content: userMessage }]
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!r.ok) {
      const err = await r.text();
      return { error: `AI error: ${r.status}` };
    }

    const d = await r.json();
    const text = d.content?.map(c => c.text || '').join('') || '';
    return { text, tokens: d.usage };
  } catch (e) {
    return { error: e.message || 'AI timeout' };
  }
}

// ═══ RATE LIMITING ═══
const rateLimits = new Map(); // key -> { count, resetAt }

function rateLimit(key, maxPerMinute = 20) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}

// Clean up rate limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) { if (now > v.resetAt) rateLimits.delete(k); }
}, 300000);


// ═══════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', agents: db.prepare('SELECT COUNT(*) as c FROM agents').get().c, users: db.prepare('SELECT COUNT(*) as c FROM users').get().c });
});

// --- Market Data ---
app.get('/api/market', async (req, res) => {
  const data = await getMarketData();
  res.json(data);
});

// --- Agents: List ---
app.get('/api/agents', (req, res) => {
  const { sort, tag, limit } = req.query;
  let q = 'SELECT id, name, icon, description, color, tools_prices, tools_wallet, tools_tonapi, price_per_query, creator_wallet, is_core, tags, total_queries, rating_sum, rating_count, created_at FROM agents WHERE is_public = 1';
  const params = [];

  if (tag) { q += ' AND tags LIKE ?'; params.push(`%${tag}%`); }

  if (sort === 'popular') q += ' ORDER BY total_queries DESC';
  else if (sort === 'rating') q += ' ORDER BY CASE WHEN rating_count > 0 THEN rating_sum / rating_count ELSE 0 END DESC';
  else if (sort === 'new') q += ' ORDER BY created_at DESC';
  else q += ' ORDER BY is_core DESC, total_queries DESC';

  q += ' LIMIT ?';
  params.push(parseInt(limit) || 50);

  const agents = db.prepare(q).all(...params);
  res.json(agents.map(a => ({
    ...a,
    tools: { prices: !!a.tools_prices, wallet: !!a.tools_wallet, tonapi: !!a.tools_tonapi },
    rating: a.rating_count > 0 ? (a.rating_sum / a.rating_count).toFixed(1) : null,
    tags: a.tags ? a.tags.split(',') : []
  })));
});

// --- Agents: Get one ---
app.get('/api/agents/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND is_public = 1').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({
    ...agent,
    tools: { prices: !!agent.tools_prices, wallet: !!agent.tools_wallet, tonapi: !!agent.tools_tonapi },
    rating: agent.rating_count > 0 ? (agent.rating_sum / agent.rating_count).toFixed(1) : null,
    tags: agent.tags ? agent.tags.split(',') : []
  });
});

// --- Agents: Create ---
app.post('/api/agents', (req, res) => {
  const { name, icon, description, system_prompt, knowledge, tools, price_per_query, tags, is_public } = req.body;
  if (!name || !system_prompt) return res.status(400).json({ error: 'Name and system_prompt required' });

  const id = 'ag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const fullPrompt = knowledge ? system_prompt + '\n\n[KNOWLEDGE]\n' + knowledge : system_prompt;

  db.prepare(`INSERT INTO agents (id, name, icon, description, system_prompt, tools_prices, tools_wallet, tools_tonapi, price_per_query, creator_id, creator_wallet, is_public, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, name, icon || '🤖', description || name, fullPrompt,
    tools?.prices ? 1 : 0, tools?.wallet ? 1 : 0, tools?.tonapi ? 1 : 0,
    price_per_query || 0.01,
    req.user?.id || null, req.body.creator_wallet || '',
    is_public !== false ? 1 : 0,
    Array.isArray(tags) ? tags.join(',') : (tags || '')
  );

  res.json({ id, name, status: 'deployed' });
});

// --- Agents: Update ---
app.put('/api/agents/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  if (agent.is_core) return res.status(403).json({ error: 'Cannot edit core agent' });

  const { name, icon, description, system_prompt, tools, price_per_query, tags } = req.body;
  db.prepare(`UPDATE agents SET name = COALESCE(?,name), icon = COALESCE(?,icon), description = COALESCE(?,description),
    system_prompt = COALESCE(?,system_prompt), tools_prices = COALESCE(?,tools_prices), tools_wallet = COALESCE(?,tools_wallet),
    tools_tonapi = COALESCE(?,tools_tonapi), price_per_query = COALESCE(?,price_per_query), tags = COALESCE(?,tags),
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    name, icon, description, system_prompt,
    tools?.prices !== undefined ? (tools.prices ? 1 : 0) : null,
    tools?.wallet !== undefined ? (tools.wallet ? 1 : 0) : null,
    tools?.tonapi !== undefined ? (tools.tonapi ? 1 : 0) : null,
    price_per_query,
    Array.isArray(tags) ? tags.join(',') : tags,
    req.params.id
  );
  res.json({ status: 'updated' });
});

// --- Agents: Delete ---
app.delete('/api/agents/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  if (agent.is_core) return res.status(403).json({ error: 'Cannot delete core' });
  db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
  res.json({ status: 'deleted' });
});

// --- Chat: Query an agent ---
app.post('/api/chat', async (req, res) => {
  const { agent_id, message, wallet_address } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const agentId = agent_id || 'agnt_core';
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Rate limit
  const rlKey = req.user?.telegram_id || req.ip;
  if (!rateLimit(rlKey, 30)) return res.status(429).json({ error: 'Rate limited. Try again in a minute.' });

  // Build real tool context
  const toolsUsed = [];
  if (agent.tools_prices) toolsUsed.push('Live Prices');
  if (agent.tools_wallet && wallet_address) toolsUsed.push('Wallet Data');
  if (agent.tools_tonapi) toolsUsed.push('On-Chain Data');

  const context = await buildContext(agent, wallet_address);

  // Add user memory
  if (req.user) {
    const memories = db.prepare('SELECT content FROM memory WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 5')
      .all(agentId, req.user.id).map(m => m.content);
    if (memories.length) {
      // Context already built, append memory
    }
  }

  // Call AI
  const result = await queryAI(agent.system_prompt, message, context);
  if (result.error) return res.status(500).json({ error: result.error });

  // Update stats
  db.prepare('UPDATE agents SET total_queries = total_queries + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(agentId);

  // Log query
  const queryRow = db.prepare('INSERT INTO queries (agent_id, user_id, user_message, agent_response, tools_used, cost) VALUES (?, ?, ?, ?, ?, ?)')
    .run(agentId, req.user?.id || null, message, result.text, toolsUsed.join(','), agent.price_per_query);

  // Extract memory keywords
  const memKw = ['portfolio', 'hold', 'invest', 'bought', 'sold', 'prefer', 'risk', 'strateg', 'goal', 'budget', 'watch'];
  if (req.user && memKw.some(k => message.toLowerCase().includes(k))) {
    db.prepare('INSERT INTO memory (agent_id, user_id, content) VALUES (?, ?, ?)')
      .run(agentId, req.user.id, message.slice(0, 200));
    // Keep max 10 memories per user-agent pair
    db.prepare('DELETE FROM memory WHERE id IN (SELECT id FROM memory WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 10)')
      .run(agentId, req.user.id);
  }

  // Auto-post interesting responses to feed (if response is substantial)
  if (result.text.length > 100 && Math.random() < 0.3) {
    db.prepare('INSERT INTO feed (agent_id, content, tools_used, source_query_id) VALUES (?, ?, ?, ?)')
      .run(agentId, result.text.slice(0, 500), toolsUsed.join(','), queryRow.lastInsertRowid);
  }

  res.json({
    text: result.text,
    tools_used: toolsUsed,
    tokens: result.tokens,
    agent: { id: agentId, name: agent.name }
  });
});

// --- Feed ---
app.get('/api/feed', (req, res) => {
  const { limit, before } = req.query;
  let q = 'SELECT f.*, a.name as agent_name, a.icon as agent_icon, a.color as agent_color FROM feed f JOIN agents a ON f.agent_id = a.id';
  const params = [];
  if (before) { q += ' WHERE f.created_at < ?'; params.push(before); }
  q += ' ORDER BY f.created_at DESC LIMIT ?';
  params.push(parseInt(limit) || 20);
  res.json(db.prepare(q).all(...params));
});

// --- Rate agent ---
app.post('/api/agents/:id/rate', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  const { score } = req.body;
  if (!score || score < 1 || score > 5) return res.status(400).json({ error: 'Score 1-5 required' });

  db.prepare('INSERT INTO ratings (agent_id, user_id, score) VALUES (?, ?, ?) ON CONFLICT(agent_id, user_id) DO UPDATE SET score = excluded.score')
    .run(req.params.id, req.user.id, score);

  // Update agent rating cache
  const stats = db.prepare('SELECT SUM(score) as s, COUNT(*) as c FROM ratings WHERE agent_id = ?').get(req.params.id);
  db.prepare('UPDATE agents SET rating_sum = ?, rating_count = ? WHERE id = ?').run(stats.s, stats.c, req.params.id);

  res.json({ status: 'rated', rating: (stats.s / stats.c).toFixed(1) });
});

// --- Follow agent ---
app.post('/api/agents/:id/follow', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    db.prepare('INSERT INTO follows (user_id, agent_id) VALUES (?, ?)').run(req.user.id, req.params.id);
    res.json({ status: 'followed' });
  } catch (e) {
    db.prepare('DELETE FROM follows WHERE user_id = ? AND agent_id = ?').run(req.user.id, req.params.id);
    res.json({ status: 'unfollowed' });
  }
});

// --- User profile ---
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ authenticated: false });
  const agentCount = db.prepare('SELECT COUNT(*) as c FROM agents WHERE creator_id = ?').get(req.user.id).c;
  const queryCount = db.prepare('SELECT COUNT(*) as c FROM queries WHERE user_id = ?').get(req.user.id).c;
  res.json({ ...req.user, agents_created: agentCount, total_queries: queryCount, authenticated: true });
});

// --- User's agents ---
app.get('/api/me/agents', (req, res) => {
  if (!req.user) return res.json([]);
  const agents = db.prepare('SELECT * FROM agents WHERE creator_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(agents);
});

// ═══ START ═══
app.listen(PORT, () => {
  console.log(`AGNT backend running on port ${PORT}`);
  console.log(`Database: ${db.name}`);
  console.log(`AI: ${CLAUDE_KEY ? 'Configured' : '⚠️  Set CLAUDE_API_KEY'}`);
  console.log(`Auth: ${BOT_TOKEN ? 'Configured' : '⚠️  Set BOT_TOKEN for Telegram auth'}`);
});
