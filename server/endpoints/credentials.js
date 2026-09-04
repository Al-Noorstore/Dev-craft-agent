// ============================================
// CREDENTIAL VAULT - /api/credentials
// Solene-style skill: user tokens/keys save kare,
// agent unhe encrypt karke rakhta hai aur khud use karta hai.
//
// POST { action: "save", name: "GITHUB_TOKEN", value: "ghp_xxx", user_id: "u_123", description: "..." }
// HAR USER ka apna vault - user_id ke hisaab se alag (default 'owner')
// POST { action: "list" } / GET
// POST { action: "delete", name: "GITHUB_TOKEN" }
// => values KABHI plain nahi lautti, sirf masked
// Requires: Supabase + "credentials" table (SQL README mein)
// ============================================
const vault = require('../lib/credentials.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const action = req.method === 'GET' ? 'list' : (body.action || 'list');
    // har user ka apna vault - user_id body/query se (default 'owner')
    const userId = body.user_id || new URL(req.url, 'http://x').searchParams.get('user_id') || 'owner';

    if (action === 'save') {
      const r = await vault.saveCredential(body.name, body.value, body.description, userId);
      return res.status(r.error ? 400 : 200).json(r);
    }
    if (action === 'delete') {
      const r = await vault.deleteCredential(body.name, userId);
      return res.status(r.error ? 400 : 200).json(r);
    }
    if (action === 'list') {
      const r = await vault.listCredentials(userId);
      return res.status(r.error ? 500 : 200).json(r);
    }
    return res.status(400).json({ error: 'action: save | list | delete' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
