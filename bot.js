// ═══════════════════════════════════════
//  AGNT Telegram Bot v2
//  Multi-turn conversations + webhooks
// ═══════════════════════════════════════

const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://dearsealx-blip.github.io/agnt-app';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Set for production

if (!TOKEN) { console.error('Set BOT_TOKEN'); process.exit(1); }

// Webhook mode for production, polling for dev
const botOptions = WEBHOOK_URL 
  ? { webHook: { port: process.env.WEBHOOK_PORT || 8443 } }
  : { polling: { interval: 1000, autoStart: true, params: { timeout: 30 } } };

const bot = new TelegramBot(TOKEN, botOptions);

if (WEBHOOK_URL) {
  bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
  console.log(`Webhook set: ${WEBHOOK_URL}`);
}

// ═══ MULTI-TURN CONVERSATION MEMORY ═══
// Keep last 6 messages per chat (3 pairs)
const chatHistory = new Map();
const MAX_HISTORY = 6;

function getHistory(chatId) {
  return chatHistory.get(chatId) || [];
}

function addToHistory(chatId, role, text) {
  let hist = chatHistory.get(chatId) || [];
  hist.push({ role, text: text.slice(0, 500) });
  if (hist.length > MAX_HISTORY) hist = hist.slice(-MAX_HISTORY);
  chatHistory.set(chatId, hist);
}

// Clean up old conversations every 30 min
setInterval(() => {
  const limit = 1000; // Keep max 1000 chats
  if (chatHistory.size > limit) {
    const keys = [...chatHistory.keys()];
    keys.slice(0, keys.length - limit).forEach(k => chatHistory.delete(k));
  }
}, 1800000);

// ═══ ERROR HANDLING ═══
bot.on('polling_error', (err) => {
  console.error('Bot polling error:', err.code || err.message);
  // Don't crash — just log and continue
});

bot.on('error', (err) => {
  console.error('Bot error:', err.message);
});

// ═══ COMMANDS ═══

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const param = (match[1] || '').trim();
  const name = msg.from.first_name || 'there';

  if (param && param.length > 10) {
    await bot.sendMessage(chatId,
      `Hey ${name}! Someone shared an agent with you. 🤖`,
      { reply_markup: { inline_keyboard: [[{ text: '🤖 Import Agent', web_app: { url: `${WEBAPP_URL}?startapp=${param}` } }]] } }
    );
    return;
  }

  await bot.sendMessage(chatId,
    `Hey ${name}! I'm AGNT — a real AI with live market data and wallet access on TON. 🤖\n\n` +
    `Just send me any message and I'll answer with real data.\n\n` +
    `Commands: /price /agents /create /arena /help`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🤖 Open Full App', web_app: { url: WEBAPP_URL } }],
          [{ text: '📈 Quick Price', callback_data: 'price' }, { text: '✨ Create Agent', callback_data: 'create' }]
        ]
      }
    }
  );
});

bot.onText(/\/price/, async (msg) => {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
    const d = await r.json();
    const ton = d['the-open-network'];
    const arrow = ton.usd_24h_change >= 0 ? '🟢' : '🔴';
    const mcap = ton.usd_market_cap ? `$${(ton.usd_market_cap / 1e9).toFixed(2)}B` : '';

    await bot.sendMessage(msg.chat.id,
      `${arrow} *TON:* $${ton.usd.toFixed(3)} (${ton.usd_24h_change >= 0 ? '+' : ''}${ton.usd_24h_change.toFixed(1)}%) ${mcap ? '· MCap: ' + mcap : ''}\n` +
      `⚡ *BTC:* $${d.bitcoin.usd.toLocaleString()}\n` +
      `💎 *ETH:* $${d.ethereum.usd.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    await bot.sendMessage(msg.chat.id, '⚠️ Price data temporarily unavailable. Try again in a moment.');
  }
});

bot.onText(/\/agents/, async (msg) => {
  try {
    const r = await fetch(`${BACKEND_URL}/api/agents?limit=10&sort=popular`);
    if (!r.ok) throw new Error();
    const agents = await r.json();
    let text = '🤖 *Top Agents*\n\n';
    agents.forEach((a, i) => {
      text += `${i + 1}. ${a.icon} *${a.name}* — ${a.total_queries || 0} queries\n   _${(a.description || '').slice(0, 50)}_\n\n`;
    });
    await bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🤖 Browse All', web_app: { url: WEBAPP_URL } }]] }
    });
  } catch (e) {
    await bot.sendMessage(msg.chat.id, 'Open the app to browse agents:', {
      reply_markup: { inline_keyboard: [[{ text: '🤖 Open AGNT', web_app: { url: WEBAPP_URL } }]] }
    });
  }
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🤖 *AGNT — Real AI on TON*\n\n` +
    `/price — Live TON/BTC/ETH\n` +
    `/agents — Browse agents\n` +
    `/create — Build your own agent\n` +
    `/arena — AI debate arena\n` +
    `/clear — Reset conversation\n\n` +
    `Or just type anything — I'll respond with live data. I remember our last few messages for context.`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/clear/, (msg) => {
  chatHistory.delete(msg.chat.id);
  bot.sendMessage(msg.chat.id, '🗑️ Conversation cleared. Start fresh!');
});

bot.onText(/\/create/, (msg) => {
  bot.sendMessage(msg.chat.id, '✨ Create your agent:', {
    reply_markup: { inline_keyboard: [[{ text: '✨ Open Builder', web_app: { url: WEBAPP_URL + '#create' } }]] }
  });
});

bot.onText(/\/arena/, (msg) => {
  bot.sendMessage(msg.chat.id, '⚔️ Watch AI agents debate:', {
    reply_markup: { inline_keyboard: [[{ text: '⚔️ Open Arena', web_app: { url: WEBAPP_URL + '#arena' } }]] }
  });
});

// ═══ CALLBACK QUERIES ═══
bot.on('callback_query', async (query) => {
  await bot.answerCallbackQuery(query.id);
  const chatId = query.message.chat.id;

  if (query.data === 'price') {
    // Simulate /price
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true');
      const d = await r.json();
      const ton = d['the-open-network'];
      const arrow = ton.usd_24h_change >= 0 ? '🟢' : '🔴';
      await bot.sendMessage(chatId,
        `${arrow} *TON:* $${ton.usd.toFixed(3)} (${ton.usd_24h_change >= 0 ? '+' : ''}${ton.usd_24h_change.toFixed(1)}%)\n*BTC:* $${d.bitcoin.usd.toLocaleString()} · *ETH:* $${d.ethereum.usd.toLocaleString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) { await bot.sendMessage(chatId, '⚠️ Try again.'); }
  } else {
    await bot.sendMessage(chatId, 'Open the app:', {
      reply_markup: { inline_keyboard: [[{ text: '🤖 Open AGNT', web_app: { url: WEBAPP_URL } }]] }
    });
  }
});

// ═══ FREE TEXT → AGNT WITH CONTEXT ═══
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  await bot.sendChatAction(chatId, 'typing');

  // Add user message to history
  addToHistory(chatId, 'user', msg.text);
  const history = getHistory(chatId);

  try {
    // Build context with history
    const historyContext = history.slice(0, -1).map(m => 
      `${m.role === 'user' ? 'User' : 'AGNT'}: ${m.text}`
    ).join('\n');

    const r = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'agnt_core',
        message: historyContext ? `[CONVERSATION HISTORY]\n${historyContext}\n\n[CURRENT MESSAGE]\n${msg.text}` : msg.text
      })
    });
    const data = await r.json();

    if (data.text) {
      addToHistory(chatId, 'assistant', data.text);
      
      let prefix = '';
      if (data.tools_used?.length) {
        prefix = data.tools_used.map(t => `✅ ${t}`).join(' · ') + '\n\n';
      }

      const response = prefix + data.text;
      await bot.sendMessage(chatId, response.slice(0, 4000), {
        reply_markup: {
          inline_keyboard: [[{ text: '🤖 Full App', web_app: { url: WEBAPP_URL } }]]
        }
      });
    } else {
      await bot.sendMessage(chatId, data.error || '⚠️ Something went wrong. Try again.');
    }
  } catch (e) {
    // Fallback: direct CoinGecko + simple response
    try {
      const pr = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd&include_24hr_change=true');
      const pd = await pr.json();
      const ton = pd['the-open-network'];
      await bot.sendMessage(chatId,
        `⚠️ Backend offline. Here's what I can tell you:\n\nTON: $${ton.usd.toFixed(3)} (${ton.usd_24h_change >= 0 ? '+' : ''}${ton.usd_24h_change.toFixed(1)}%)\n\nFor full AI responses, open the app:`,
        { reply_markup: { inline_keyboard: [[{ text: '🤖 Open AGNT', web_app: { url: WEBAPP_URL } }]] } }
      );
    } catch (e2) {
      await bot.sendMessage(chatId, '⚠️ I\'m having trouble connecting. Try the full app:', {
        reply_markup: { inline_keyboard: [[{ text: '🤖 Open AGNT', web_app: { url: WEBAPP_URL } }]] }
      });
    }
  }
});

// ═══ INLINE QUERIES ═══
bot.on('inline_query', async (query) => {
  try {
    const r = await fetch(`${BACKEND_URL}/api/agents?limit=10`);
    const agents = await r.json();
    const results = agents.map(a => ({
      type: 'article', id: a.id,
      title: `${a.icon} ${a.name}`,
      description: (a.description || '').slice(0, 80),
      input_message_content: {
        message_text: `🤖 *${a.name}*\n${(a.description || '').slice(0, 100)}\n\n${a.total_queries || 0} queries${a.rating ? ' · ⭐ ' + a.rating : ''}`,
        parse_mode: 'Markdown'
      },
      reply_markup: { inline_keyboard: [[{ text: `Chat with ${a.name}`, web_app: { url: WEBAPP_URL } }]] }
    }));
    await bot.answerInlineQuery(query.id, results, { cache_time: 60 });
  } catch (e) { await bot.answerInlineQuery(query.id, []); }
});

console.log(`AGNT Bot running (${WEBHOOK_URL ? 'webhook' : 'polling'} mode)`);
