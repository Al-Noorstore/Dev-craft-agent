// ============================================
// BRAIN KEY FETCH - /api/brain-key
// Desktop app "Cloud se key lao" button ke liye.
// Passphrase ka sirf SHA-256 hash yahan hai (repo public hai) —
// sahi passphrase pe hi Vercel env ki asli Gemini key milti hai.
// ============================================
const crypto = require('crypto');

const PASS_HASH = '0b3e54bd1e443729172a5c5c12078ab040371fc08cdbf7fa7b4ac186a1823171';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  try {
    const body = req.body || {};
    const pass = String(body.pass || '');
    const given = crypto.createHash('sha256').update(pass).digest('hex');
    if (given !== PASS_HASH) return res.status(403).json({ ok: false, error: 'Passphrase ghalat hai — jo tumne set kiya hai (chhota, yaad rakhne wala)' });
    const key = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
    if (!key) return res.status(500).json({ ok: false, error: 'Server pe koi key set nahi hai' });
    return res.status(200).json({
      ok: true,
      provider: process.env.GEMINI_API_KEY ? 'gemini' : 'openai',
      api_key: key,
      model: process.env.GEMINI_API_KEY ? 'gemini-flash-latest' : 'gpt-4o-mini',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
