// ============================================
// DISCORD NOTIFICATIONS - /api/discord
// POST { "text": "New lead: Thompson Construction (score 82)" }
// Discord channel mein message bhejta hai
// Requires: DISCORD_WEBHOOK_URL
// Setup: Discord server > channel settings > Integrations > Webhooks > New Webhook > Copy URL
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (!process.env.DISCORD_WEBHOOK_URL) {
      return res.status(500).json({
        error: 'Discord not configured',
        setup_help: 'Discord server > channel > Edit > Integrations > Webhooks > New Webhook > Copy URL > DISCORD_WEBHOOK_URL set karo.'
      });
    }

    const dcRes = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Dev Craft Agent',
        content: text
      })
    });

    if (!dcRes.ok) throw new Error('Discord error: ' + (await dcRes.text()).slice(0, 200));
    res.json({ success: true, sent: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
