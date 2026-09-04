// ============================================
// GITLAB TOOL - /api/gitlab
// POST { "action": "list_projects" }
// POST { "action": "create_project", "name": "client-website" }
// POST { "action": "push_file", "project_id": 123, "path": "index.html", "content": "...", "commit_message": "..." }
// POST { "action": "get_file", "project_id": 123, "path": "index.html", "branch": "main" }
// Requires: GITLAB_TOKEN (Personal Access Token - api scope)
//   gitlab.com > Settings > Access Tokens > scope: api
//   Self-hosted GitLab ho to GITLAB_API_URL bhi set karo (default: https://gitlab.com)
// ============================================
const vault = require('../lib/credentials.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const TOKEN = await vault.getCredential('GITLAB_TOKEN');
    if (!TOKEN) {
      return res.status(500).json({
        error: 'GitLab not configured',
        setup_help: 'gitlab.com > Preferences > Access Tokens > "api" scope wala token banao > GITLAB_TOKEN set karo.'
      });
    }
    const API = (process.env.GITLAB_API_URL || 'https://gitlab.com').replace(/\/$/, '') + '/api/v4';
    const H = { 'PRIVATE-TOKEN': TOKEN, 'Content-Type': 'application/json' };
    const { action, name, description, project_id, path, content, commit_message, branch } = req.body || {};

    if (action === 'list_projects') {
      const r = await fetch(API + '/projects?membership=true&per_page=50&order_by=updated_at', { headers: H });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'GitLab error');
      return res.json({ count: data.length, projects: data.map(x => ({ id: x.id, name: x.name, url: x.web_url, visibility: x.visibility })) });
    }

    if (action === 'create_project') {
      if (!name) return res.status(400).json({ error: 'name required' });
      const r = await fetch(API + '/projects', {
        method: 'POST', headers: H,
        body: JSON.stringify({ name, description: description || '', visibility: 'private' })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'GitLab error');
      return res.json({ success: true, project_id: data.id, url: data.web_url });
    }

    if (action === 'push_file') {
      if (!project_id || !path || content === undefined) return res.status(400).json({ error: 'project_id, path, content required' });
      const r = await fetch(`${API}/projects/${project_id}/repository/files/${encodeURIComponent(path)}`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          branch: branch || 'main',
          content: String(content),
          commit_message: commit_message || 'Update ' + path
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'GitLab error');
      return res.json({ success: true, committed: path, branch: branch || 'main' });
    }

    if (action === 'get_file') {
      if (!project_id || !path) return res.status(400).json({ error: 'project_id, path required' });
      const r = await fetch(`${API}/projects/${project_id}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch || 'main')}`, { headers: H });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'File not found');
      return res.json({ path, content: Buffer.from(data.content, 'base64').toString('utf8') });
    }

    res.status(400).json({ error: 'action required: list_projects | create_project | push_file | get_file' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
