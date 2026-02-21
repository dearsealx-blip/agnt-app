// Run this once to seed agent templates into the database
// Usage: node seed.js

const Database = require('better-sqlite3');
const { AGENT_TEMPLATES } = require('./templates');

const db = new Database(process.env.DB_PATH || './agnt.db');

console.log('Seeding agent templates...');

const stmt = db.prepare(`INSERT OR IGNORE INTO agents 
  (id, name, icon, description, system_prompt, color, tools_prices, tools_wallet, tools_tonapi, price_per_query, is_core, is_public, tags)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`);

const tx = db.transaction(() => {
  for (const t of AGENT_TEMPLATES) {
    const fullPrompt = t.knowledge ? t.prompt + '\n\n[KNOWLEDGE]\n' + t.knowledge : t.prompt;
    stmt.run(
      t.id, t.name, t.icon, t.description, fullPrompt, t.color,
      t.tools.prices ? 1 : 0, t.tools.wallet ? 1 : 0, t.tools.tonapi ? 1 : 0,
      t.price, t.tags.join(',')
    );
    console.log(`  ✓ ${t.icon} ${t.name}`);
  }
});

tx();
console.log(`\nDone. ${AGENT_TEMPLATES.length} templates seeded.`);
db.close();
