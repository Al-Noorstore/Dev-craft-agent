// ============================================
// CREDENTIAL VAULT - /api/credentials
// Solene-style skill: user tokens/keys save kare,
// agent unhe encrypt karke rakhta hai aur khud use karta hai.
//
// POST { action: "save", name: "GITHUB_TOKEN", value: "ghp_xxx", description: "..." }
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

    if (action === 'save') {
      const r = await vault.saveCredential(body.name, body.value, body.description);
      return res.status(r.error ? 400 : 200).json(r);
    }
    if (action === 'delete') {
      const r = await vault.deleteCredential(body.name);
      return res.status(r.error ? 400 : 200).json(r);
    }
    if (action === 'list') {
      const r = await vault.listCredentials();
      return res.status(r.error ? 500 : 200).json(r);
    }
    return res.status(400).json({ error: 'action: save | list | delete' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
