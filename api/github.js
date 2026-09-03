// ============================================
// GITHUB TOOL - /api/github
// POST { "action": "list_repos" }
// POST { "action": "create_repo", "name": "client-website", "private": true, "description": "..." }
// POST { "action": "push_file", "repo": "client-website", "path": "index.html", "content": "...", "message": "add homepage" }
// POST { "action": "get_file", "repo": "client-website", "path": "index.html" }
// Requires: GITHUB_TOKEN (Personal Access Token)
//   github.com > Settings > Developer settings > Personal access tokens > Fine-grained
//   Permissions: Repositories (read/write), Contents (read/write)
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const TOKEN = process.env.GITHUB_TOKEN;
    if (!TOKEN) {
      return res.status(500).json({
        error: 'GitHub not configured',
        setup_help: 'github.com > Settings > Developer settings > Personal access tokens > Generate new token (repo permissions) > GITHUB_TOKEN set karo.'
      });
    }
    const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    const { action, name, private: isPrivate, description, repo, path, content, message, branch } = req.body || {};

    if (action === 'list_repos') {
      const r = await fetch('https://api.github.com/user/repos?per_page=50&sort=updated', { headers: H });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'GitHub error');
      return res.json({ count: data.length, repos: data.map(x => ({ name: x.name, private: x.private, url: x.html_url, updated: x.updated_at })) });
    }

    if (action === 'create_repo') {
      if (!name) return res.status(400).json({ error: 'name required' });
      const r = await fetch('https://api.github.com/user/repos', {
        method: 'POST', headers: H,
        body: JSON.stringify({ name, private: isPrivate !== false, description: description || '', auto_init: true })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'GitHub error');
      return res.json({ success: true, repo: data.name, url: data.html_url, clone_url: data.clone_url, private: data.private });
    }

    if (action === 'push_file') {
      if (!repo || !path || content === undefined) return res.status(400).json({ error: 'repo, path, content required' });
      // get owner from token
      const me = await (await fetch('https://api.github.com/user', { headers: H })).json();

      // check if file exists (need sha to update)
      const br = branch || 'main';
      const check = await fetch(`https://api.github.com/repos/${me.login}/${repo}/contents/${encodeURI(path)}?ref=${br}`, { headers: H });
      const existing = check.ok ? await check.json() : null;

      const r = await fetch(`https://api.github.com/repos/${me.login}/${repo}/contents/${encodeURI(path)}`, {
        method: 'PUT', headers: H,
        body: JSON.stringify({
          message: message || 'Update ' + path,
          content: Buffer.from(String(content)).toString('base64'),
          branch: br,
          ...(existing ? { sha: existing.sha } : {})
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'GitHub error');
      return res.json({ success: true, committed: path, url: data.content ? data.content.html_url : null });
    }

    if (action === 'get_file') {
      if (!repo || !path) return res.status(400).json({ error: 'repo, path required' });
      const me = await (await fetch('https://api.github.com/user', { headers: H })).json();
      const r = await fetch(`https://api.github.com/repos/${me.login}/${repo}/contents/${encodeURI(path)}`, { headers: H });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'File not found');
      return res.json({ path, content: Buffer.from(data.content, 'base64').toString('utf8'), size: data.size });
    }

    res.status(400).json({ error: 'action required: list_repos | create_repo | push_file | get_file' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
