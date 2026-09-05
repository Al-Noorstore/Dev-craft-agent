// ============================================
// MCP MANAGER - /api/mcp
// User apne MCP servers connect kare (per-user):
//   POST { action:"save", name:"supabase", url:"https://...", token:"..." }
//   POST { action:"list" }
//   POST { action:"delete", name:"supabase" }
//   POST { action:"test", name:"supabase" }  ya { url, token } (abhi test)
//   POST { action:"call", name:"supabase", tool:"x", args:{...} }
// Auth: Google login (Supabase) ho to REAL user id.
// Table SQL README mein (mcp_servers).
// ============================================
const mcp = require('../lib/mcp.js');
const vault = require('../lib/credentials.js');
const auth = require('../lib/auth.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.body || {};
    const action = req.method === 'GET' ? 'list' : (body.action || 'list');
    const authR = await auth.resolveUser(req, body.user_id || 'owner');
    const uid = authR.uid;

    const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!SB_URL || !SB_KEY) return res.status(500).json({ error: 'Supabase env vars missing' });
    const H = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

    if (action === 'save') {
      if (!body.name || !body.url) return res.status(400).json({ error: 'name aur url chahiye' });
      const enc = body.token ? vault.encryptText(body.token) : null;
      const r = await fetch(SB_URL + '/rest/v1/mcp_servers?on_conflict=user_id,name', {
        method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          user_id: uid, name: String(body.name).trim().toLowerCase(),
          url: body.url, token_enc: enc ? enc.value_enc : null, token_iv: enc ? enc.iv : null, token_tag: enc ? enc.tag : null,
          updated_at: new Date().toISOString()
        })
      });
      return res.status(r.ok ? 200 : 500).json(r.ok ? { ok: true, saved: body.name } : { error: 'save fail (HTTP ' + r.status + ') - mcp_servers table hai?' });
    }

    if (action === 'list') {
      const r = await fetch(SB_URL + '/rest/v1/mcp_servers?user_id=eq.' + encodeURIComponent(uid) + '&select=name,url,updated_at&order=updated_at.desc', { headers: H });
      if (!r.ok) return res.status(500).json({ error: 'list fail (HTTP ' + r.status + ')' });
      const rows = await r.json();
      return res.json({ user_id: uid, servers: rows }); // tokens kabhi nahi lautte
    }

    if (action === 'delete') {
      const r = await fetch(SB_URL + '/rest/v1/mcp_servers?user_id=eq.' + encodeURIComponent(uid) + '&name=eq.' + encodeURIComponent(String(body.name).toLowerCase()), { method: 'DELETE', headers: H });
      return res.status(r.ok ? 200 : 500).json(r.ok ? { ok: true, deleted: body.name } : { error: 'delete fail' });
    }

    if (action === 'test') {
      // saved server ya direct url test karo
      let url = body.url, token = body.token || null;
      if (body.name) {
        const r = await fetch(SB_URL + '/rest/v1/mcp_servers?user_id=eq.' + encodeURIComponent(uid) + '&name=eq.' + encodeURIComponent(String(body.name).toLowerCase()) + '&select=name,url,token_enc,token_iv,token_tag', { headers: H });
        const rows = await r.json();
        if (!rows || !rows[0]) return res.status(404).json({ error: 'server nahi mila: ' + body.name });
        url = rows[0].url;
        token = rows[0].token_enc ? vault.decryptText(rows[0].token_enc, rows[0].token_iv, rows[0].token_tag) : null;
      }
      if (!url) return res.status(400).json({ error: 'url ya name do' });
      const tools = await mcp.listTools(url, token);
      return res.json({ ok: true, connected: true, tools: tools.slice(0, 40) });
    }

    if (action === 'call') {
      if (!body.name || !body.tool) return res.status(400).json({ error: 'name aur tool chahiye' });
      const r = await fetch(SB_URL + '/rest/v1/mcp_servers?user_id=eq.' + encodeURIComponent(uid) + '&name=eq.' + encodeURIComponent(String(body.name).toLowerCase()) + '&select=name,url,token_enc,token_iv,token_tag', { headers: H });
      const rows = await r.json();
      if (!rows || !rows[0]) return res.status(404).json({ error: 'MCP server nahi mila: ' + body.name });
      const token = rows[0].token_enc ? vault.decryptText(rows[0].token_enc, rows[0].token_iv, rows[0].token_tag) : null;
      const result = await mcp.callTool(rows[0].url, token, body.tool, body.args || {});
      return res.json(result);
    }

    return res.status(400).json({ error: 'action: save | list | delete | test | call' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
