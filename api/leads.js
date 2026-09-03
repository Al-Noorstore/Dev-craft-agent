// ============================================
// LEADS DATABASE - /api/leads
// POST { lead data } => save lead (Supabase pe)
// GET  => saare leads list karo
// Requires Supabase (FREE): https://supabase.com
//   - New project banao
//   - Table banao: leads (columns: id, name, category, city, email, phone, website, audit_score, lead_score, status, notes)
//   - Settings > API se URL + anon key lo
//   - SUPABASE_URL + SUPABASE_ANON_KEY env vars set karo
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const SB_URL = process.env.SUPABASE_URL;
    const SB_KEY = process.env.SUPABASE_ANON_KEY;
    if (!SB_URL || !SB_KEY) {
      return res.status(500).json({
        error: 'Supabase env vars missing',
        setup_help: 'supabase.com pe free project banao, "leads" table banao, phir SUPABASE_URL aur SUPABASE_ANON_KEY set karo.'
      });
    }

    const headers = {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    // SAVE lead
    if (req.method === 'POST') {
      const lead = req.body || {};
      if (!lead.name) return res.status(400).json({ error: 'name is required' });
      const insertRes = await fetch(SB_URL + '/rest/v1/leads', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: lead.name,
          category: lead.category || null,
          city: lead.city || null,
          email: lead.email || null,
          phone: lead.phone || null,
          website: lead.website || null,
          audit_score: lead.audit_score ?? null,
          lead_score: lead.lead_score ?? null,
          status: lead.status || 'new',
          notes: lead.notes || null
        })
      });
      if (!insertRes.ok) throw new Error('Supabase insert failed: ' + await insertRes.text());
      const saved = await insertRes.json();
      return res.json({ success: true, lead: saved[0] });
    }

    // LIST leads
    const listRes = await fetch(SB_URL + '/rest/v1/leads?select=*&order=lead_score.desc.nullslast', { headers });
    if (!listRes.ok) throw new Error('Supabase query failed: ' + await listRes.text());
    const leads = await listRes.json();
    res.json({ count: leads.length, leads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
