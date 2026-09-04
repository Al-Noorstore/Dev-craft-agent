// ============================================
// BRIDGE - /api/bridge  (PC/Laptop connect system)
// User apne PC/laptop ko agent se connect karta hai:
//   1. UI "Get pairing code" deta hai (action: start_pair)
//   2. User apne PC pe chalata hai: node bridge.js <CODE> (repo root script)
//   3. Bridge register karta hai (action: register, device_name/os/ollama_models)
//   4. Bridge har 2s poll karta hai pending jobs ke liye (action: poll)
//   5. Agent PC pe shell commands chala sakta hai (jobs table se)
//   6. Local Ollama models real-time dikhte hain (heartbeat mein update)
//
// Supabase tables chahiye:
//   bridge_devices: id uuid, code text, device_name text, os text,
//     ollama_models jsonb, status text, last_seen timestamptz, created_at timestamptz
//   bridge_jobs: id uuid, device_id uuid, type text, payload jsonb,
//     status text, result jsonb, created_at, completed_at timestamptz
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_ANON_KEY;
  const setupHelp = {
    error: 'Supabase env vars missing',
    setup_help: 'supabase.com pe free project banao, 2 tables banao: bridge_devices (id uuid, code text, device_name text, os text, ollama_models jsonb, status text, last_seen timestamptz, created_at timestamptz) aur bridge_jobs (id uuid, device_id uuid, type text, payload jsonb, status text, result jsonb, created_at timestamptz, completed_at timestamptz). Phir SUPABASE_URL + SUPABASE_ANON_KEY env vars set karo.'
  };

  try {
    if (!SB_URL || !SB_KEY) return res.status(500).json(setupHelp);

    const headers = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
    const body = req.body || {};
    const action = body.action || 'devices';

    // ---- START PAIR: UI code maangta hai ----
    if (action === 'start_pair') {
      const code = require('crypto').randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
      const insRes = await fetch(SB_URL + '/rest/v1/bridge_devices', {
        method: 'POST', headers,
        body: JSON.stringify({ code, device_name: 'Waiting for PC...', os: 'unknown', status: 'pairing', ollama_models: [] })
      });
      if (!insRes.ok) return res.status(500).json({ error: 'Supabase insert failed: ' + (await insRes.text()).slice(0, 150) });
      const rows = await insRes.json();
      return res.json({ success: true, code, device_id: rows[0].id, message: 'Apne PC pe ye command chalao: node bridge.js ' + code });
    }

    // ---- REGISTER: bridge script PC se call karta hai ----
    if (action === 'register') {
      const { code, device_name, os, ollama_models } = body;
      if (!code) return res.status(400).json({ error: 'code required' });
      const updRes = await fetch(SB_URL + '/rest/v1/bridge_devices?code=eq.' + encodeURIComponent(code), {
        method: 'PATCH', headers,
        body: JSON.stringify({ device_name: device_name || 'My PC', os: os || 'unknown', ollama_models: ollama_models || [], status: 'connected', last_seen: new Date().toISOString() })
      });
      if (!updRes.ok) return res.status(500).json({ error: 'Register failed - code galat ya table missing' });
      const rows = await updRes.json();
      if (!rows.length) return res.status(404).json({ error: 'Pairing code nahi mila - UI se naya code lo' });
      return res.json({ success: true, device_id: rows[0].id, device: rows[0] });
    }

    // ---- POLL: bridge pending jobs maangta hai (heartbeat bhi) ----
    if (action === 'poll') {
      const { device_id, ollama_models } = body;
      if (!device_id) return res.status(400).json({ error: 'device_id required' });
      // heartbeat + ollama models update
      await fetch(SB_URL + '/rest/v1/bridge_devices?id=eq.' + encodeURIComponent(device_id), {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'connected', last_seen: new Date().toISOString(), ...(ollama_models ? { ollama_models } : {}) })
      });
      // pending job uthao aur claim karo (single bridge per device: safe)
      const jobsRes = await fetch(SB_URL + '/rest/v1/bridge_jobs?device_id=eq.' + encodeURIComponent(device_id) + '&status=eq.pending&order=created_at.asc&limit=1', { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
      if (!jobsRes.ok) return res.status(500).json({ error: 'Jobs fetch failed: ' + (await jobsRes.text()).slice(0, 150) });
      const jobs = await jobsRes.json();
      if (!jobs.length) return res.json({ success: true, jobs: [] });
      const job = jobs[0];
      await fetch(SB_URL + '/rest/v1/bridge_jobs?id=eq.' + encodeURIComponent(job.id), {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'running' })
      });
      return res.json({ success: true, jobs: [job] });
    }

    // ---- RESULT: bridge job ka result post karta hai ----
    if (action === 'result') {
      const { job_id, result, status } = body;
      if (!job_id) return res.status(400).json({ error: 'job_id required' });
      await fetch(SB_URL + '/rest/v1/bridge_jobs?id=eq.' + encodeURIComponent(job_id), {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: status === 'error' ? 'error' : 'done', result: result || null, completed_at: new Date().toISOString() })
      });
      return res.json({ success: true });
    }

    // ---- DEVICES: UI ke liye list (online = last_seen < 60s pehle) ----
    if (action === 'devices') {
      const dRes = await fetch(SB_URL + '/rest/v1/bridge_devices?select=*&order=created_at.desc', { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
      if (!dRes.ok) return res.status(500).json({ error: 'Devices fetch failed: ' + (await dRes.text()).slice(0, 150) });
      const devices = await dRes.json();
      const now = Date.now();
      const withStatus = devices.map(d => ({ ...d, online: d.status === 'connected' && d.last_seen && (now - new Date(d.last_seen).getTime()) < 60000 }));
      return res.json({ success: true, devices: withStatus });
    }

    // ---- JOB STATUS: server-side wait ke liye (chat.js poll karta hai) ----
    if (action === 'job_status') {
      const { job_id } = body;
      if (!job_id) return res.status(400).json({ error: 'job_id required' });
      const jRes = await fetch(SB_URL + '/rest/v1/bridge_jobs?id=eq.' + encodeURIComponent(job_id) + '&select=*', { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
      if (!jRes.ok) return res.status(500).json({ error: 'Job fetch failed' });
      const rows = await jRes.json();
      return res.json({ success: true, job: rows[0] || null });
    }

    // ---- DISCONNECT ----
    if (action === 'disconnect') {
      const { device_id } = body;
      if (!device_id) return res.status(400).json({ error: 'device_id required' });
      await fetch(SB_URL + '/rest/v1/bridge_devices?id=eq.' + encodeURIComponent(device_id), {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'disconnected' })
      });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
