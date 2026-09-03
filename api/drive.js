// ============================================
// GOOGLE DRIVE - /api/drive
// POST { "action": "save", "name": "Proposal_Thompson.txt", "content": "..." }
//   => Drive folder mein nayi file save karta hai
// POST { "action": "list" }  => folder ki saari files
// POST { "action": "search", "query": "proposal" }  => naam se search
// POST { "action": "read", "file_id": "..." }  => file ka content parho
// Requires (Google Cloud Console — Sheets jaisa Service Account):
//   1. GOOGLE_DRIVE_CLIENT_EMAIL + GOOGLE_DRIVE_PRIVATE_KEY (service account JSON se)
//   2. GOOGLE_DRIVE_FOLDER_ID (optional — folder URL se /folders/THIS_PART;
//      nahi doge to root mein jayegi)
//   3. Drive mein folder bana kar service account ke email ko Share karo (Editor)
//   4. console.cloud.google.com pe "Google Drive API" enable karna zaroori hai!
// ============================================
const crypto = require('crypto');

async function getDriveToken() {
  const { GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY } = process.env;
  if (!GOOGLE_DRIVE_CLIENT_EMAIL || !GOOGLE_DRIVE_PRIVATE_KEY) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: GOOGLE_DRIVE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claim);
  const sig = signer.sign(process.env.GOOGLE_DRIVE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'base64url');
  const jwt = header + '.' + claim + '.' + sig;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const data = await tokenRes.json();
  return data.access_token || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const token = await getDriveToken();
    if (!token) {
      return res.status(500).json({
        error: 'Google Drive not configured',
        setup_help: 'Google Cloud Console > Service Account banao > JSON key > GOOGLE_DRIVE_CLIENT_EMAIL + GOOGLE_DRIVE_PRIVATE_KEY set karo > "Google Drive API" enable karo > apne Drive folder ko service account email se share karo (GOOGLE_DRIVE_FOLDER_ID optional).'
      });
    }

    const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const headers = { Authorization: 'Bearer ' + token };
    const { action, name, content, query, file_id } = req.body || {};

    // ---------- SAVE file ----------
    if (action === 'save') {
      if (!name || content === undefined) {
        return res.status(400).json({ error: 'name aur content required' });
      }
      const meta = {
        name,
        mimeType: 'text/plain',
        ...(FOLDER_ID ? { parents: [FOLDER_ID] } : {})
      };
      const boundary = 'gcab' + Date.now();
      const multipart =
        '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(meta) +
        '\r\n--' + boundary + '\r\nContent-Type: text/plain\r\n\r\n' +
        String(content) +
        '\r\n--' + boundary + '--';

      const upRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'multipart/related; boundary=' + boundary },
        body: multipart
      });
      const data = await upRes.json();
      if (!upRes.ok) throw new Error(data.error ? data.error.message : 'Drive upload failed');
      return res.json({ success: true, file_id: data.id, link: data.webViewLink, saved_as: name });
    }

    // ---------- LIST folder ----------
    if (action === 'list') {
      let url = 'https://www.googleapis.com/drive/v3/files?fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=50';
      url += FOLDER_ID
        ? '&q=' + encodeURIComponent(`'${FOLDER_ID}' in parents and trashed=false`)
        : '&q=' + encodeURIComponent('trashed=false');
      const listRes = await fetch(url, { headers });
      const data = await listRes.json();
      if (!listRes.ok) throw new Error(data.error ? data.error.message : 'Drive list failed');
      return res.json({ count: (data.files || []).length, files: data.files || [] });
    }

    // ---------- SEARCH ----------
    if (action === 'search') {
      if (!query) return res.status(400).json({ error: 'query required' });
      const q = `name contains '${query.replace(/'/g, "\\'")}' and trashed=false`;
      const sRes = await fetch(
        'https://www.googleapis.com/drive/v3/files?fields=files(id,name,mimeType,modifiedTime,webViewLink)&q=' + encodeURIComponent(q),
        { headers }
      );
      const data = await sRes.json();
      if (!sRes.ok) throw new Error(data.error ? data.error.message : 'Drive search failed');
      return res.json({ count: (data.files || []).length, results: data.files || [] });
    }

    // ---------- READ file ----------
    if (action === 'read') {
      if (!file_id) return res.status(400).json({ error: 'file_id required' });
      const readRes = await fetch('https://www.googleapis.com/drive/v3/files/' + file_id + '?alt=media', { headers });
      if (!readRes.ok) throw new Error('File read failed (sirf text files parh sakta hai)');
      const text = await readRes.text();
      return res.json({ file_id, content: text.slice(0, 5000) });
    }

    res.status(400).json({ error: 'action required: save | list | search | read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
