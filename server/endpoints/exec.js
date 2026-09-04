// ============================================
// EXEC - /api/exec  (SELF-HOSTED ONLY!)
// POST { "command": "ls -la", "token": "..." }
// Commands run karta hai — LEKIN sirf tab jab:
//   1. Ye agent KHUDKE laptop/PC pe chal raha ho (vercel dev / node)
//   2. Env var EXEC_ENABLED=true set ho
//   3. (Optional) EXEC_TOKEN set ho to sahi token bhi chahiye
//
// ⚠️ VERCEL PE YE KABHI ENABLE MAT KARO!
//    Vercel = public internet pe sab khol sakte hain = bahut khatra.
//    Cloud pe commands chalana "like Solene" wala feature SIRF apne
//    system pe possible hai. Vercel deploy pe ye endpoint "disabled"
//    message dega — ye intended behavior hai.
// ============================================
const { exec } = require('child_process');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  // ---- SECURITY GATES ----
  if (process.env.EXEC_ENABLED !== 'true') {
    return res.status(403).json({
      enabled: false,
      message: 'Exec disabled hai. Ye feature SIRF self-hosted ke liye hai — apne PC pe: EXEC_ENABLED=true set karke "vercel dev" ya node se chalao. Vercel/cloud pe kabhi enable mat karna — security risk!'
    });
  }
  if (process.env.EXEC_TOKEN && req.body.token !== process.env.EXEC_TOKEN) {
    return res.status(403).json({ error: 'Invalid token (EXEC_TOKEN set hai — sahi token bhejo)' });
  }

  try {
    const { command, timeout } = req.body || {};
    if (!command) return res.status(400).json({ error: 'command required' });

    // Sanitize: kuch commands block (self-protection)
    const blocked = [/rm\s+-rf\s+\/(\s|$)/, /shutdown/, /reboot/, /mkfs/, /:\(\)\s*\{\s*:\|:&\s*\};/];
    if (blocked.some(rx => rx.test(command))) {
      return res.status(400).json({ error: 'Ye command blocked hai (system-destroying commands not allowed)' });
    }

    exec(command, { timeout: Math.min(timeout || 10000, 30000), maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      res.json({
        command,
        output: (stdout || '').slice(0, 8000) || null,
        error_output: (stderr || '').slice(0, 3000) || null,
        exit_code: err ? (err.code || 1) : 0,
        ok: !err
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
