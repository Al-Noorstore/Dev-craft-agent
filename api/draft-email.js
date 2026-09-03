// ============================================
// AI EMAIL DRAFTER - /api/draft-email
// POST { "business_name", "category", "city", "issues": [...], "tone": "friendly|formal" }
// Outreach email draft banata hai - agency ke honest rules ke saath
// ============================================
const OpenAI = require('openai');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { business_name, category, city, issues, tone, sender_name } = req.body || {};
    if (!business_name) return res.status(400).json({ error: 'business_name is required' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY env var missing (set it in Vercel)' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You write cold outreach emails for a web design agency (Dev Craft Studio). Return JSON: { "subject": "...", "body": "..." }
STRICT RULES:
- Honest, respectful, no deceptive claims, no spam tactics, no fake urgency
- NEVER guarantee sales, clients, revenue, or profit
- Short (under 150 words), professional, ${tone === 'formal' ? 'formal' : 'friendly-warm'} tone
- Mention specific real issues observed on their website
- Offer a FREE homepage concept as next step
- End with sender name: ${sender_name || 'Wishal'} and "Dev Craft Studio"
- No pushy language like "act now", "limited time", "last chance"`
        },
        {
          role: 'user',
          content: JSON.stringify({
            business_name, category, city,
            website_issues: issues || ['outdated design'],
            example_greeting: 'Hi ' + business_name + ' team,'
          })
        }
      ],
      max_tokens: 500
    });

    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
