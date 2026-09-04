// ============================================
// VERCEL HOST - /api/deploy-vercel
// Static website files ko seedha Vercel pe deploy karta hai — LIVE URL return!
// Agency superpower: client website banao => yahan bhejo => client ko link do.
//
// POST {
//   "secret": "..."        => DEPLOY_SECRET env var se match hona chahiye
//   "project_name": "client-website"  (a-z, 0-9, - only)
//   "files": [{"name": "index.html", "content": "..."}, ...]  (index.html zaroori)
//   "team_id": "..."       (optional — team account pe deploy karne ke liye)
// }
//
// ENV VARS (Vercel dashboard mein set karo):
//   VERCEL_TOKEN  => vercel.com > Account Settings > Tokens
//   DEPLOY_SECRET => koi bhi strong password (security lock)
// ============================================
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const token = process.env.VERCEL_TOKEN;
  const secret = process.env.DEPLOY_SECRET;
  if (!token || !secret) {
    return res.status(400).json({ error: 'Deploy disabled: VERCEL_TOKEN aur DEPLOY_SECRET env vars set karo (Vercel > Project > Settings > Environment Variables)' });
  }

  try {
    const { secret: reqSecret, project_name, files, team_id } = req.body || {};
    if (reqSecret !== secret) return res.status(403).json({ error: 'galat secret' });

    // ---- validation ----
    if (!project_name || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(project_name))
      return res.status(400).json({ error: 'project_name required (lowercase letters, numbers, dashes)' });
    if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'files required: [{name, content}]' });
    if (!files.some(f => f && f.name === 'index.html')) return res.status(400).json({ error: 'index.html zaroori hai (root mein)' });
    if (files.length > 200) return res.status(400).json({ error: 'max 200 files' });

    const q = team_id ? `?teamId=${encodeURIComponent(team_id)}` : '';
    const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // ---- 1. project ensure (exists => 409 ignore) ----
    const projRes = await fetch(`https://api.vercel.com/v9/projects${q}`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ name: project_name, framework: null })
    });
    if (![200, 201, 409].includes(projRes.status)) {
      const err = await projRes.json().catch(() => ({}));
      return res.status(400).json({ error: `project create fail: ${err.error?.message || projRes.status}` });
    }

    // ---- 2. protection OFF (warna client login page dekhega) ----
    await fetch(`https://api.vercel.com/v9/projects/${project_name}${q}`, {
      method: 'PATCH', headers: authHeaders,
      body: JSON.stringify({ ssoProtection: null })
    }).catch(() => {});

    // ---- 3. files deploy ----
    const deployFiles = files
      .filter(f => f && f.name && typeof f.content === 'string' && !f.name.includes('..'))
      .map(f => {
        const data = Buffer.from(f.content, 'utf8').toString('base64');
        return { file: f.name.replace(/^\/+/, ''), data, sha: crypto.createHash('sha1').update(data).digest('hex') };
      });

    const depRes = await fetch(`https://api.vercel.com/v13/deployments${q}`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({
        name: project_name,
        target: 'production',
        projectSettings: { framework: null },
        files: deployFiles,
      })
    });
    const dep = await depRes.json().catch(() => ({}));
    if (!depRes.ok || !dep.id) {
      return res.status(400).json({ error: `deploy fail: ${dep.error?.message || depRes.status}` });
    }

    // ---- 4. ready hone tak wait (static sites fast hoti hain) ----
    let state = dep.readyState || 'BUILDING';
    let url = dep.url;
    for (let i = 0; i < 12 && state !== 'READY'; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const st = await fetch(`https://api.vercel.com/v13/deployments/${dep.id}${q}`, { headers: authHeaders });
      const stJson = await st.json().catch(() => ({}));
      state = stJson.readyState || state;
      url = stJson.url || url;
      if (state === 'ERROR' || state === 'CANCELED') break;
    }

    return res.json({
      success: state === 'READY',
      project_name,
      deployment_id: dep.id,
      state,
      live_url: url ? `https://${url}` : null,
      message: state === 'READY'
        ? 'Website LIVE hai! 🎉'
        : `Deploy ${state} mein hai — thodi der baad https://${project_name}.vercel.app check karo`,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
