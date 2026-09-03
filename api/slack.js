// ============================================
// SLACK NOTIFICATIONS - /api/slack
// POST { "text": "New lead: Thompson Construction (score 82)" }
// Slack channel mein message bhejta hai (new lead notifications etc.)
// Requires: SLACK_WEBHOOK_URL
// Setup: api.slack.com/messaging/webhooks > channel choose karo > "Incoming Webhook" create karo
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
    if (!process.env.SLACK_WEBHOOK_URL) {
      return res.status(500).json({
        error: 'Slack not configured',
        setup_help: 'api.slack.com/messaging/webhooks > apna workspace/channel select > Incoming Webhook create > URL copy karke SLACK_WEBHOOK_URL set karo.'
      });
    }

    const slackRes = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '🤖 Dev Craft Agent: ' + text })
    });

    if (!slackRes.ok) throw new Error('Slack error: ' + await slackRes.text());
    res.json({ success: true, sent: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
