// ============================================
// GOOGLE SHEETS - /api/sheets
// POST { "row": ["Business", "City", "Email", "Score"] } => Leads sheet mein nayi row
// GET => sheet ka data parho
// Requires (Google Cloud Console > Service Account):
//   1. Service account banao > JSON key download karo
//   2. GOOGLE_SHEETS_CLIENT_EMAIL + GOOGLE_SHEETS_PRIVATE_KEY (JSON wali, \n ke saath)
//   3. GOOGLE_SHEET_ID (sheet URL se — /d/THIS_PART/edit)
//   4. Sheet mein service account ke email ko Share karo (Editor)
// ============================================
const crypto = require('crypto');

async function getGoogleToken() {
  const { GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY } = process.env;
  if (!GOOGLE_SHEETS_CLIENT_EMAIL || !GOOGLE_SHEETS_PRIVATE_KEY) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: GOOGLE_SHEETS_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claim);
  const sig = signer.sign(process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'), 'base64url');
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const token = await getGoogleToken();
    if (!SHEET_ID || !token) {
      return res.status(500).json({
        error: 'Google Sheets not configured',
        setup_help: 'Google Cloud Console > Service Account banao > JSON key > GOOGLE_SHEETS_CLIENT_EMAIL + GOOGLE_SHEETS_PRIVATE_KEY + GOOGLE_SHEET_ID set karo, aur sheet mein service account email ko share karo.'
      });
    }
    const sheetName = (req.body && req.body.sheet) || 'Leads';
    const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/' + encodeURIComponent(sheetName);

    if (req.method === 'POST') {
      const { row } = req.body || {};
      if (!Array.isArray(row)) return res.status(400).json({ error: 'row must be an array, e.g. ["Name","City","Email"]' });
      const appendRes = await fetch(base + ':append?valueInputOption=USER_ENTERED', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] })
      });
      if (!appendRes.ok) throw new Error('Sheets append failed: ' + await appendRes.text());
      return res.json({ success: true, added: row });
    }

    // GET - read sheet
    const readRes = await fetch(base, { headers: { Authorization: 'Bearer ' + token } });
    const data = await readRes.json();
    res.json({ rows: (data.values || []).length, data: data.values || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
