// ============================================
// GMAIL INBOX READER - /api/read-emails
// GET or POST { "max": 10, "classify": true }
// Gmail inbox ke latest emails laata hai + AI classify karta hai
// Requires: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
// (Google Cloud Console > OAuth client banao > refresh token lo)
// ============================================
const OpenAI = require('openai');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const max = Math.min(body.max || 10, 20);
    const classify = body.classify !== false;

    const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
      return res.status(500).json({
        error: 'Gmail env vars missing',
        setup_help: 'Google Cloud Console > OAuth 2.0 Client ID banao > Gmail API enable > refresh token generate karo. Phir GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN set karo.'
      });
    }

    // 1. Refresh token => access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Gmail token refresh failed: ' + (tokenData.error_description || ''));
    const accessToken = tokenData.access_token;

    // 2. List messages (inbox)
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=' + max,
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    const listData = await listRes.json();
    const messages = listData.messages || [];

    // 3. Get each message details (parallel, fast)
    const emails = await Promise.all(messages.slice(0, max).map(async (m) => {
      const msgRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + m.id + '?format=metadata',
        { headers: { Authorization: 'Bearer ' + accessToken } });
      const msg = await msgRes.json();
      const headers = msg.payload.headers;
      const get = (name) => (headers.find(h => h.name.toLowerCase() === name) || {}).value || '';
      return {
        id: m.id,
        from: get('from'),
        subject: get('subject'),
        date: get('date'),
        snippet: (msg.snippet || '').slice(0, 300)
      };
    }));

    // 4. AI classification (optional)
    let classifications = null;
    if (classify && process.env.OPENAI_API_KEY && emails.length > 0) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Classify each email for a web design agency owner. Return JSON: { "results": [ { "subject": "...", "classification": "INTERESTED | NOT_INTERESTED | QUESTION | FOLLOW_UP_NEEDED | SPAM | OTHER", "priority": "high|medium|low", "suggested_action": "one short line" } ] }`
          },
          { role: 'user', content: JSON.stringify(emails.map(e => ({ subject: e.subject, from: e.from, snippet: e.snippet }))) }
        ],
        max_tokens: 700
      });
      classifications = JSON.parse(completion.choices[0].message.content).results;
    }

    res.json({ count: emails.length, emails, classifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
