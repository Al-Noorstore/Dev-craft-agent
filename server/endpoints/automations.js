// ============================================
// AUTOMATIONS - /api/automations
// User agent se kahe "ye kaam roz karo" => yahan save hota hai.
// Roz 9 AM PKT /api/run-automations (Vercel cron) inhe khud chalata hai.
// Supabase table chahiye: automations (id uuid, name text, prompt text,
//   schedule text, active boolean default true, last_run timestamptz, created_at timestamptz)
// POST { action: "create"|"list"|"delete", name?, prompt?, schedule?, id? }
// GET  => list (direct browser/API ke liye)
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY; // RLS-safe

  const setupHelp = {
    error: 'Supabase env vars missing',
    setup_help: 'supabase.com pe free project banao, "automations" table banao (id uuid, name text, prompt text, schedule text, active boolean, last_run timestamptz, created_at timestamptz), phir SUPABASE_URL aur SUPABASE_ANON_KEY set karo.'
  };

  try {
    const body = req.body || {};
    let action = body.action;
    if (!action) action = req.method === 'DELETE' ? 'delete' : req.method === 'GET' ? 'list' : 'create';

    if (!SB_URL || !SB_KEY) return res.status(500).json(setupHelp);

    const headers = {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    // CREATE
    if (action === 'create') {
      const { name, prompt, schedule } = body;
      if (!name || !prompt) return res.status(400).json({ error: 'name and prompt are required' });
      const insertRes = await fetch(SB_URL + '/rest/v1/automations', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, prompt, schedule: schedule || 'daily', active: true })
      });
      if (!insertRes.ok) {
        const errText = await insertRes.text();
        return res.status(500).json({ error: 'Supabase insert failed: ' + errText.slice(0, 200), setup_help: setupHelp.setup_help });
      }
      const rows = await insertRes.json();
      return res.json({ success: true, automation: rows[0], message: `Automation "${name}" saved - roz 9 AM PKT khud chalega ✅` });
    }

    // LIST
    if (action === 'list') {
      const listRes = await fetch(SB_URL + '/rest/v1/automations?select=*&order=created_at.desc', { headers });
      if (!listRes.ok) {
        const errText = await listRes.text();
        return res.status(500).json({ error: 'Supabase list failed: ' + errText.slice(0, 200), setup_help: setupHelp.setup_help });
      }
      const rows = await listRes.json();
      return res.json({ success: true, automations: rows, count: rows.length });
    }

    // DELETE
    if (action === 'delete') {
      const id = body.id || (req.query && req.query.id);
      if (!id) return res.status(400).json({ error: 'id is required' });
      const delRes = await fetch(SB_URL + '/rest/v1/automations?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=representation' }
      });
      if (!delRes.ok) return res.status(500).json({ error: 'Supabase delete failed' });
      const rows = await delRes.json();
      if (!rows.length) return res.status(404).json({ error: 'Automation not found (id: ' + id + ')' });
      return res.json({ success: true, deleted: rows[0].name });
    }

    return res.status(400).json({ error: 'Unknown action. Use create / list / delete.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
